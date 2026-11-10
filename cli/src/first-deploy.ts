import {
  type CloudApi,
  CloudApiError,
  type components,
} from "@antelopejs/cloud-sdk";
import type { Prompter } from "@antelopejs/core/cli";
import { writeProjectConfig } from "./config.js";
import { DEFAULT_PORT, DEFAULT_SERVICE_NAME, detectApp } from "./detect.js";
import { CliError } from "./errors.js";
import { type MessageKey, message } from "./i18n.js";
import {
  alternativeAppName,
  defaultAppName,
  isValidProjectSlug,
  isValidServiceName,
  suggestProjectSlug,
} from "./naming.js";
import { feedback } from "./output.js";
import { type DeployPlan, readCeiling, showPlan } from "./plan.js";
import {
  type Project,
  productionEnvironment,
  type Service,
} from "./project.js";
import type {
  Credentials,
  DeployOptions,
  GlobalOptions,
  ProjectConfig,
  Runtime,
} from "./types.js";
import { isValidPortText } from "./validation.js";
import { ensureWorkspaceReady } from "./workspace.js";

type ProjectSummary = components["schemas"]["ProjectList"]["projects"][number];

const SLUG_TAKEN = "cloud.errors.projects.slug_taken";
const APP_NAME_TAKEN = "cloud.errors.services.app_name_taken";
const MAX_APP_NAME_ATTEMPTS = 3;
const MAX_PROMPT_ATTEMPTS = 5;
const SERVICE_ROOT_PATH = ".";
const YES_FLAG = "--yes";
const PROJECT_FLAG = "--project <name>";
const REGION_FLAG = "--region <region>";
const PORT_FLAG = "--port <port>";

/** Everything a first deployment works with. */
export interface FirstDeployContext {
  runtime: Runtime;
  options: GlobalOptions;
  deployOptions: DeployOptions;
  api: CloudApi;
  credentials: Credentials;
  /** Answers from the flags, then `--yes` defaults, then the terminal. */
  prompter: Prompter;
}

/** The folder once linked, ready for the upload deployment. */
export interface LinkedFolder {
  root: string;
  config: ProjectConfig;
  service: string;
}

/** How one prompted value is judged, and what an invalid one is told. */
interface ValueRule {
  isValid(value: string): boolean;
  /** The failure of an invalid value given on the command line. */
  code: string;
  /** What a person who typed an invalid value is told before the retry. */
  hint: string;
  details?: string[];
}

/** One value `deploy` needs: its question, flag, default and rule. */
interface ValueQuestion {
  explicit: string | undefined;
  question: string;
  flag: string;
  fallback: string;
  rule: ValueRule;
  /** Answered by its default when nobody can be asked. */
  isOptional?: boolean;
}

/** The project a first deployment lands in: found, or to be created. */
interface ProjectChoice {
  slug: string;
  existing: Project | null;
}

/** Where a service is created: the project and its production environment. */
interface ProjectTarget {
  projectId: string;
  slug: string;
  environmentId: string;
}

function text(context: FirstDeployContext, key: MessageKey): string {
  return message(key, context.options.lang);
}

function invalid(rule: ValueRule, value: string): CliError {
  return new CliError(rule.code, { detail: value, details: rule.details });
}

/**
 * A value given on the command line, or asked for with a default.
 *
 * `--yes` never prompts: the default is taken and held to the same rule, so a
 * CI run fails with the reason instead of creating something under a name
 * nobody chose. A person who types an invalid value is told why and asked
 * again, a few times at most.
 */
async function resolveValue(
  context: FirstDeployContext,
  value: ValueQuestion,
): Promise<string> {
  const { rule } = value;
  if (value.explicit !== undefined) {
    if (!rule.isValid(value.explicit)) throw invalid(rule, value.explicit);
    return value.explicit;
  }
  for (let attempt = 0; attempt < MAX_PROMPT_ATTEMPTS; attempt += 1) {
    const answer = (
      await context.prompter.text({
        message: value.question,
        flag: value.flag,
        defaultAnswer: value.fallback,
        isOptional: value.isOptional,
      })
    ).trim();
    const chosen = answer || value.fallback;
    if (rule.isValid(chosen)) return chosen;
    if (context.options.yes) throw invalid(rule, chosen);
    context.runtime.ui.message("warn", rule.hint, { details: rule.details });
  }
  throw invalid(rule, value.fallback);
}

function slugRule(context: FirstDeployContext): ValueRule {
  return {
    isValid: isValidProjectSlug,
    code: "invalid_project_slug",
    hint: text(context, "invalidSlug"),
  };
}

function askSlug(
  context: FirstDeployContext,
  fallback: string,
  explicit?: string,
): Promise<string> {
  return resolveValue(context, {
    explicit,
    question: text(context, "promptProject"),
    flag: PROJECT_FLAG,
    fallback,
    rule: slugRule(context),
  });
}

async function readExisting(
  context: FirstDeployContext,
  summary: ProjectSummary | undefined,
): Promise<Project | null> {
  return summary ? context.api.readProject(summary.id) : null;
}

/**
 * The project slug, and whether it names a project the user can already see.
 *
 * A visible project under the chosen slug is theirs to deploy to, but only on
 * purpose: named with `--project`, or confirmed. Otherwise the next free slug
 * is proposed, and `--yes` stops rather than guess between the two.
 */
async function chooseProject(
  context: FirstDeployContext,
  fallback: string,
): Promise<ProjectChoice> {
  const { projects } = await context.api.listProjects();
  const taken = new Set(projects.map((project) => project.slug));
  const explicit = context.deployOptions.project;
  let slug = await askSlug(context, fallback, explicit);
  while (true) {
    const summary = projects.find((project) => project.slug === slug);
    if (!summary || slug === explicit) {
      return { slug, existing: await readExisting(context, summary) };
    }
    if (context.options.yes) throw new CliError("project_slug_taken", slug);
    const isConfirmed = await context.prompter.confirm({
      message: `${slug} ${text(context, "slugTakenOwned")}`,
      flag: PROJECT_FLAG,
      defaultAnswer: false,
    });
    if (isConfirmed) {
      return { slug, existing: await readExisting(context, summary) };
    }
    slug = await askSlug(context, suggestProjectSlug(slug, taken));
  }
}

/**
 * Region of a project about to be created, after checking the caller may
 * create one at all — the API would refuse later, after every question.
 */
async function chooseRegion(context: FirstDeployContext): Promise<string> {
  const state = await context.api.onboardingState();
  if (!state.canCreateProjects) {
    throw new CliError("project_creation_forbidden");
  }
  const regions = `${text(context, "availableRegions")} ${state.regions.join(", ")}`;
  const rule: ValueRule = {
    isValid: (region) => state.regions.includes(region),
    code: "unknown_region",
    hint: text(context, "unknownRegion"),
    details: [regions],
  };
  const explicit =
    context.deployOptions.region ??
    (state.regions.length > 1 ? undefined : state.defaultRegion);
  return resolveValue(context, {
    explicit,
    question: text(context, "promptRegion"),
    flag: REGION_FLAG,
    fallback: state.defaultRegion,
    rule,
  });
}

function chooseService(
  context: FirstDeployContext,
  requested: string | undefined,
): Promise<string> {
  return resolveValue(context, {
    explicit: requested,
    question: text(context, "promptService"),
    flag: "[service]",
    fallback: DEFAULT_SERVICE_NAME,
    isOptional: true,
    rule: {
      isValid: isValidServiceName,
      code: "invalid_service_name",
      hint: text(context, "invalidServiceName"),
    },
  });
}

async function choosePort(
  context: FirstDeployContext,
  detected: number | null,
): Promise<number> {
  const port = await resolveValue(context, {
    explicit: context.deployOptions.port,
    question: text(context, "promptPort"),
    flag: PORT_FLAG,
    fallback: String(detected ?? DEFAULT_PORT),
    rule: {
      isValid: isValidPortText,
      code: "invalid_port",
      hint: text(context, "invalidPort"),
    },
  });
  return Number(port);
}

function isApiError(cause: unknown, code: string): boolean {
  return cause instanceof CloudApiError && cause.code === code;
}

function targetOf(project: Project): ProjectTarget {
  return {
    projectId: project.id,
    slug: project.slug,
    environmentId: productionEnvironment(project).id,
  };
}

/**
 * Creates the project, or returns the existing one chosen.
 *
 * The slug was free in the list the user sees, but a project outside their
 * scope, or one created meanwhile, can still hold it: the API's 409 is then
 * answered with the next free slug to accept or replace.
 */
async function ensureProject(
  context: FirstDeployContext,
  choice: ProjectChoice,
  region: string,
): Promise<ProjectTarget> {
  if (choice.existing) return targetOf(choice.existing);
  const taken = new Set<string>();
  let slug = choice.slug;
  while (true) {
    try {
      const created = await context.api.createProject({ slug, region });
      feedback(context.runtime, context.options, {
        type: "project_created",
        data: created,
        level: "success",
        text: `${text(context, "created")}: ${created.slug} (${created.region})`,
      });
      return created;
    } catch (error) {
      if (context.options.yes || !isApiError(error, SLUG_TAKEN)) throw error;
      taken.add(slug);
      context.runtime.ui.message(
        "warn",
        `${slug} ${text(context, "slugTaken")}`,
      );
      slug = await askSlug(context, suggestProjectSlug(slug, taken));
    }
  }
}

/**
 * Creates the production service the folder uploads to, public on its port.
 *
 * The application name is the public subdomain, unique across the platform:
 * when the derived one is someone else's, a short random suffix is tried
 * rather than asking the user to invent a hostname.
 */
async function createUploadService(
  context: FirstDeployContext,
  target: ProjectTarget,
  name: string,
  port: number | null,
): Promise<string> {
  let appName = defaultAppName(target.slug, name);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const created = await context.api.createService(
        target.projectId,
        target.environmentId,
        { name, appName, source: { type: "upload" }, port, isPublic: !!port },
      );
      feedback(context.runtime, context.options, {
        type: "service_created",
        data: created,
        level: "success",
        text: `${text(context, "created")}: ${created.name} (${created.appName})`,
      });
      return created.serviceId;
    } catch (error) {
      const canRetry = attempt < MAX_APP_NAME_ATTEMPTS;
      if (!canRetry || !isApiError(error, APP_NAME_TAKEN)) throw error;
      appName = alternativeAppName(defaultAppName(target.slug, name));
      feedback(context.runtime, context.options, {
        type: "app_name_retry",
        data: { appName },
        level: "info",
        text: `${text(context, "appNameRetry")} ${appName}`,
      });
    }
  }
}

async function showCeiling(
  context: FirstDeployContext,
  serviceId: string,
): Promise<void> {
  const ceiling = await readCeiling(
    context.api,
    serviceId,
    context.options.lang,
  );
  if (!ceiling) return;
  feedback(context.runtime, context.options, {
    type: "service_ceiling",
    data: { serviceId, ceiling },
    level: "info",
    text: `${text(context, "ceiling")}: ${ceiling}`,
  });
}

/** Writes the link exactly as `link` does, the folder as the service's root. */
async function linkFolder(
  context: FirstDeployContext,
  target: ProjectTarget,
  service: string,
): Promise<LinkedFolder> {
  const config: ProjectConfig = {
    workspace: context.credentials.workspace,
    project: target.projectId,
    services: { [service]: { path: SERVICE_ROOT_PATH } },
  };
  await writeProjectConfig(context.runtime.cwd, config);
  feedback(context.runtime, context.options, {
    type: "project_linked",
    data: config,
    level: "success",
    text: `${text(context, "linked")}: ${target.slug}`,
  });
  return { root: context.runtime.cwd, config, service };
}

/** The plan, with what it reuses, before anything is written. */
interface PlannedDeploy {
  plan: DeployPlan;
  project: ProjectChoice;
  existingService: Service | null;
}

async function planDeploy(
  context: FirstDeployContext,
  requested: string | undefined,
): Promise<PlannedDeploy> {
  const detected = await detectApp(context.runtime.cwd);
  if (!detected.buildKind) throw new CliError("unsupported_source");
  await ensureWorkspaceReady(context.runtime, context.options, context.api);
  const project = await chooseProject(context, detected.projectSlug);
  const region = project.existing?.region ?? (await chooseRegion(context));
  const service = await chooseService(context, requested);
  const existingService = project.existing
    ? (productionEnvironment(project.existing).services.find(
        (item) => item.name === service,
      ) ?? null)
    : null;
  const port = existingService
    ? null
    : await choosePort(context, detected.port);
  const ceiling = existingService
    ? await readCeiling(context.api, existingService.id, context.options.lang)
    : null;
  const plan: DeployPlan = {
    project: project.slug,
    isNewProject: !project.existing,
    region,
    service,
    isNewService: !existingService,
    port,
    ceiling,
  };
  return { plan, project, existingService };
}

function confirmationOf(plan: DeployPlan): MessageKey {
  return plan.isNewProject || plan.isNewService
    ? "confirmPlan"
    : "confirmDeploy";
}

/**
 * The flags a run without a terminal must pass, named all at once before
 * any question: the values without a default it would ask for, and `--yes`
 * for the confirmation.
 */
function requireFlags(context: FirstDeployContext): void {
  if (context.options.yes) return;
  const values: [string | undefined, string][] = [
    [context.deployOptions.project, PROJECT_FLAG],
    [context.deployOptions.port, PORT_FLAG],
  ];
  const missing = values
    .filter(([value]) => value === undefined)
    .map(([, flag]) => flag);
  context.prompter.requireAnswers([...missing, YES_FLAG]);
}

/**
 * Takes an unlinked folder to a linked one: shows the plan, and once it is
 * confirmed creates what is missing — the project, its production service —
 * then writes the link the upload deployment reads.
 *
 * @param context Session, options and the API
 * @param requested Service named on the command line, if any
 */
export async function createFirstDeployment(
  context: FirstDeployContext,
  requested: string | undefined,
): Promise<LinkedFolder | null> {
  feedback(context.runtime, context.options, {
    type: "project_not_linked",
    data: { cwd: context.runtime.cwd },
    level: "info",
    text: text(context, "notLinked"),
  });
  requireFlags(context);
  const { plan, project, existingService } = await planDeploy(
    context,
    requested,
  );
  showPlan(context.runtime, context.options, plan);
  const isConfirmed = await context.prompter.confirm({
    message: text(context, confirmationOf(plan)),
    flag: YES_FLAG,
    answer: context.options.yes || undefined,
    defaultAnswer: false,
  });
  if (!isConfirmed) {
    feedback(context.runtime, context.options, {
      type: "deploy_declined",
      data: plan,
      level: "skip",
      text: text(context, "nothingChanged"),
    });
    return null;
  }
  const target = await ensureProject(context, project, plan.region);
  if (!existingService) {
    const serviceId = await createUploadService(
      context,
      target,
      plan.service,
      plan.port,
    );
    await showCeiling(context, serviceId);
  }
  return linkFolder(context, target, plan.service);
}
