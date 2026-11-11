import { CloudApiError } from "@antelopejs/cloud-sdk/errors";
import {
  type CliProblem,
  CliError as CoreCliError,
  USAGE_EXIT_CODE,
} from "@antelopejs/core/cli";
import { CliError } from "./errors.js";
import { isRecord, isString } from "./guards.js";
import { language } from "./i18n.js";
import { asInvoked } from "./invocation.js";
import { isFetchFailure, NETWORK_ERROR, networkCause } from "./network.js";
import { PROBLEM_TEXTS, type ProblemText } from "./problems.js";

/** A `{name}` a problem text is filled at: `{detail}`, or a refusal's value. */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;
const FALLBACK_CODE = "cli_error";
const USAGE_ERROR_CODE = "usage_error";
/** Codes of the failures the core output module raises, by error name. */
const CORE_ERROR_CODES = new Map([
  ["NeedsInputError", "needs_input"],
  ["CancelledError", "cancelled"],
]);
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;
const CONFLICT_STATUS = 409;
const TOO_MANY_REQUESTS_STATUS = 429;
const SERVER_ERROR_STATUS = 500;
const QUOTA_ERROR_PREFIX = "cloud.errors.limits.";

/**
 * Failures of the command line itself: nothing was attempted, and the run
 * exits with the usage code, as a mistyped option does.
 */
const USAGE_CODES = new Set([
  "invalid_api_url",
  "invalid_timeout",
  "invalid_port",
  "invalid_project_slug",
  "invalid_service_name",
  "invalid_service_path",
  "invalid_service_dockerfile",
  "service_path_outside_project",
  "unknown_region",
]);

/** API refusals the CLI can meet, told in the user's words. */
const API_PROBLEMS = new Map<string, string>([
  ["cloud.errors.projects.invalid_slug", "api.invalidSlug"],
  ["cloud.errors.projects.slug_taken", "api.slugTaken"],
  ["cloud.errors.limits.projects_per_workspace", "api.projectLimit"],
  ["cloud.errors.limits.services_per_environment", "api.serviceLimit"],
  ["cloud.errors.limits.hostnames_per_tenant", "api.hostnameLimit"],
  ["cloud.errors.settings.invalid_service_name", "api.invalidServiceName"],
  ["cloud.errors.settings.service_name_taken", "api.serviceNameTaken"],
  ["cloud.errors.builds.unsupported_source_archive", "api.unreadableSource"],
  ["cloud.errors.builds.no_build_recipe", "api.unbuildable"],
  ["cloud.errors.builds.missing_start_script", "api.missingStartScript"],
  ["cloud.errors.builds.monorepo_unsupported", "api.monorepoUnsupported"],
  [
    "cloud.errors.builds.node_version_unsupported",
    "api.nodeVersionUnsupported",
  ],
  ["cloud.errors.builds.source_too_large", "api.sourceTooLarge"],
  ["cloud.errors.builds.submodules_unsupported", "api.submodulesUnsupported"],
  ["cloud.errors.builds.lfs_unsupported", "api.lfsUnsupported"],
  ["cloud.errors.settings.plain_variable_limit", "api.plainVariableLimit"],
  ["cloud.errors.settings.plain_value_too_long", "api.plainValueTooLong"],
  ["cloud.errors.infra.unavailable", "api.infraUnavailable"],
  ["cloud.errors.workspace.not_ready", "api.workspaceNotReady"],
  ["cloud.errors.project.unknown_project", "api.projectGone"],
  ["cloud.errors.services.not_found", "api.serviceGone"],
  ["cloud.errors.deploy.deployment_in_progress", "api.deploymentInProgress"],
  ["cloud.errors.deploy.nothing_deployed", "api.nothingDeployed"],
  ["cloud.errors.deploy.blue_green_requires_tier", "api.plan"],
  ["cloud.errors.settings.drains_not_in_plan", "api.plan"],
  ["plan_required", "api.plan"],
]);

/** Values a problem text is filled with, by placeholder name. */
type ProblemValues = Readonly<Record<string, string>>;

function fill(text: string, values: ProblemValues): string {
  return asInvoked(text).replace(
    PLACEHOLDER_PATTERN,
    (placeholder, name: string) =>
      Object.hasOwn(values, name) ? values[name] : placeholder,
  );
}

function problemOf(
  key: string,
  lang: string | undefined,
  values: ProblemValues = {},
): CliProblem {
  const text: ProblemText = PROBLEM_TEXTS[language(lang)][key] ?? {
    title: key,
  };
  const filled = { detail: "", ...values };
  return {
    title: fill(text.title, filled),
    reason: text.reason === undefined ? undefined : fill(text.reason, filled),
    fixes: text.fixes?.map((fix) => fill(fix, filled)),
  };
}

function isQuota(error: CloudApiError): boolean {
  return (
    error.status === TOO_MANY_REQUESTS_STATUS ||
    (error.status === CONFLICT_STATUS &&
      error.code.startsWith(QUOTA_ERROR_PREFIX))
  );
}

/** The problem key of an API refusal, from its code first, then its status. */
function apiProblemKey(error: CloudApiError): string {
  const known = API_PROBLEMS.get(error.code);
  if (known) return known;
  if (error.status === UNAUTHORIZED_STATUS) return "api.sessionExpired";
  if (error.status === FORBIDDEN_STATUS) return "api.permission";
  if (isQuota(error)) return "api.quota";
  if (error.status >= SERVER_ERROR_STATUS) return "api.serverError";
  return "api.refused";
}

/**
 * An API refusal, its code and status kept for support. A refusal's values,
 * such as the Node.js versions the platform builds, fill its text.
 */
export function describeApiError(
  error: CloudApiError,
  lang?: string,
): CliProblem {
  return {
    ...problemOf(apiProblemKey(error), lang, error.params),
    details: [`${error.code} (HTTP ${error.status})`],
  };
}

/** A raw network failure, from a request made outside the API client. */
function describeNetworkError(error: Error, lang?: string): CliProblem {
  const cause = networkCause(error);
  return {
    ...problemOf(NETWORK_ERROR, lang),
    reason: undefined,
    details: cause ? [cause] : undefined,
  };
}

function describeCliError(error: CliError, lang?: string): CliProblem {
  const problem = problemOf(error.code, lang, { detail: error.detail ?? "" });
  return {
    ...problem,
    details: error.details.length ? error.details : undefined,
    exitCode: USAGE_CODES.has(error.code) ? USAGE_EXIT_CODE : undefined,
  };
}

/**
 * The problem a person reads for any failure the Cloud CLI explains: its
 * own failures, API refusals and network failures. Undefined for the rest,
 * which the core error boundary describes.
 */
export function describeFailure(
  cause: unknown,
  lang?: string,
): CliProblem | undefined {
  if (cause instanceof CloudApiError) return describeApiError(cause, lang);
  if (cause instanceof CliError) return describeCliError(cause, lang);
  if (isFetchFailure(cause)) return describeNetworkError(cause, lang);
  return undefined;
}

/** The problem of any failure, for `--json` output. */
export function problemOfAny(cause: unknown, lang?: string): CliProblem {
  if (cause instanceof CoreCliError) return cause.problem;
  const described = describeFailure(cause, lang);
  if (described) return described;
  return { title: cause instanceof Error ? cause.message : String(cause) };
}

/** The one line a problem is told in: its title, then its reason. */
export function problemSentence(problem: CliProblem): string {
  return [problem.title, problem.reason].filter(Boolean).join(". ");
}

/** The stable code scripts match on in `--json` mode. */
export function errorCode(cause: unknown): string {
  if (cause instanceof CloudApiError || cause instanceof CliError)
    return cause.code;
  if (isFetchFailure(cause)) return NETWORK_ERROR;
  const named = cause instanceof Error && CORE_ERROR_CODES.get(cause.name);
  if (named) return named;
  if (cause instanceof CoreCliError && cause.exitCode === USAGE_EXIT_CODE)
    return USAGE_ERROR_CODE;
  return isRecord(cause) && isString(cause.code) ? cause.code : FALLBACK_CODE;
}

/** The HTTP status of an API refusal, null for local failures. */
export function errorStatus(cause: unknown): number | null {
  return cause instanceof CloudApiError ? cause.status : null;
}
