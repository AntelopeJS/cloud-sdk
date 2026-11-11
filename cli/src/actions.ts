import {
  CloudApiError,
  DEFAULT_API_URL,
  type DeviceAuthorization,
  type DeviceToken,
} from "@antelopejs/cloud-sdk";
import { cloudApi, exchangeDeviceCode, requestDeviceCode } from "./api.js";
import {
  deleteCredentials,
  writeCredentials,
  writeProjectConfig,
} from "./config.js";
import { consoleUrl } from "./console-urls.js";
import { CliError } from "./errors.js";
import { format, message } from "./i18n.js";
import { asInvoked } from "./invocation.js";
import { isNetworkFailure } from "./network.js";
import { feedback, record, result } from "./output.js";
import {
  type Project,
  parseServicePaths,
  productionServices,
  publicUrl,
  serviceByName,
  withServiceDockerfiles,
} from "./project.js";
import { linkedContext, session } from "./session.js";
import { withTask } from "./tasks.js";
import type {
  GlobalOptions,
  LinkOptions,
  ProjectConfig,
  Runtime,
} from "./types.js";

export { deploy } from "./deploy.js";
export { logs } from "./logs.js";
export { status } from "./status.js";

const DEFAULT_SERVICES = ["api=apps/api", "app=apps/app"];
const PENDING_CODES = new Set(["authorization_pending"]);
const SLOW_DOWN = "slow_down";
/** RFC 8628: a `slow_down` answer adds five seconds to the polling interval. */
const SLOW_DOWN_STEP_S = 5;
const SERVER_ERROR_STATUS = 500;
const SECOND_MS = 1000;
/**
 * Login codes are limited per network at the API (20 a minute): a shared office address or
 * a scripted burst gets 429 with `Retry-After`. Waiting it out a few times turns a burst into
 * a short queue instead of failed logins; past that the refusal is the answer.
 */
const TOO_MANY_REQUESTS_STATUS = 429;
const DEVICE_RETRIES = 5;
const DEVICE_RETRY_MAX_S = 60;
const YES_FLAG = "--yes";

/**
 * Opens a link the user was already shown, as a convenience only: without a
 * person at the terminal — over SSH, in CI — or with `--no-browser`, the
 * printed link is the way through.
 */
async function openInBrowser(
  runtime: Runtime,
  options: GlobalOptions,
  url: string,
): Promise<void> {
  if (options.browser === false || !runtime.isInteractive) return;
  try {
    await runtime.open(url);
  } catch {
    if (options.json) return;
    runtime.ui.message("warn", message("browserUnavailable", options.lang));
  }
}

/**
 * Whether a failed poll of the device grant is worth repeating. Besides the
 * "not approved yet" answers, a network hiccup or a server error is not an
 * answer — the user may already have approved in the browser — so the login
 * keeps polling until the code expires.
 */
function isRetryablePoll(cause: unknown): boolean {
  if (isNetworkFailure(cause)) return true;
  if (!(cause instanceof CloudApiError)) return !(cause instanceof CliError);
  return (
    PENDING_CODES.has(cause.code) ||
    cause.code === SLOW_DOWN ||
    cause.status >= SERVER_ERROR_STATUS
  );
}

async function waitForApproval(
  runtime: Runtime,
  apiUrl: string,
  device: DeviceAuthorization,
): Promise<DeviceToken> {
  const deadline = runtime.now() + device.expires_in * SECOND_MS;
  let interval = device.interval;
  while (runtime.now() < deadline) {
    await runtime.sleep(interval * SECOND_MS);
    try {
      return await exchangeDeviceCode(apiUrl, device.device_code);
    } catch (error) {
      if (!isRetryablePoll(error)) throw error;
      if (error instanceof CloudApiError && error.code === SLOW_DOWN)
        interval += SLOW_DOWN_STEP_S;
    }
  }
  throw new CliError("device_code_expired");
}

/** A login code, waiting out a busy network's rate limit a bounded number of times. */
async function requestDevice(
  runtime: Runtime,
  options: GlobalOptions,
  apiUrl: string,
): Promise<DeviceAuthorization> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestDeviceCode(apiUrl);
    } catch (error) {
      const limited =
        error instanceof CloudApiError &&
        error.status === TOO_MANY_REQUESTS_STATUS;
      if (!limited || attempt > DEVICE_RETRIES) throw error;
      const seconds = Math.min(
        DEVICE_RETRY_MAX_S,
        Math.max(1, error.retryAfterS ?? 2 ** attempt),
      );
      feedback(runtime, options, {
        type: "login_retrying",
        data: { attempt, retryInS: seconds },
        level: "info",
        text: format("loginBusy", options.lang, { seconds: String(seconds) }),
      });
      await runtime.sleep(seconds * SECOND_MS);
    }
  }
}

/** The page to approve the login on: printed, then opened if someone can. */
async function announceLogin(
  runtime: Runtime,
  options: GlobalOptions,
  device: DeviceAuthorization,
): Promise<void> {
  const url = device.verification_uri_complete;
  result(
    runtime,
    options,
    "login_required",
    {
      verificationUrl: url,
      userCode: device.user_code,
      expiresIn: device.expires_in,
    },
    () => {
      runtime.ui.message("info", message("approve", options.lang), {
        details: [`${message("userCode", options.lang)} ${device.user_code}`],
      });
      runtime.ui.value(url);
    },
  );
  await openInBrowser(runtime, options, url);
}

function reportLogin(
  runtime: Runtime,
  options: GlobalOptions,
  token: DeviceToken,
): void {
  if (options.json) {
    record(runtime, "login_succeeded", {
      workspace: token.workspace_id,
      workspaceName: token.workspace_name,
    });
    return;
  }
  runtime.ui.summary({
    headline: message("loggedIn", options.lang),
    nextSteps: [
      {
        command: asInvoked("ajs-cloud deploy"),
        description: message("loginNext", options.lang),
      },
    ],
  });
}

export async function login(
  runtime: Runtime,
  options: GlobalOptions,
): Promise<void> {
  const apiUrl =
    options.apiUrl ?? process.env.ANTELOPE_CLOUD_URL ?? DEFAULT_API_URL;
  const device = await requestDevice(runtime, options, apiUrl);
  await announceLogin(runtime, options, device);
  const token = await withTask(runtime, options, {
    label: message("waiting", options.lang),
    work: () => waitForApproval(runtime, apiUrl, device),
    done: (approved) =>
      `${message("loggedIn", options.lang)}${runtime.ui.symbols.separator}${workspaceLabel(approved)}`,
  });
  await writeCredentials(runtime.configHome, {
    apiUrl,
    consoleUrl: new URL(device.verification_uri).origin,
    token: token.access_token,
    workspace: token.workspace_id,
  });
  reportLogin(runtime, options, token);
}

/** `Acme (tenant-1)`: the name a person picked, the id the platform uses. */
function workspaceLabel(token: DeviceToken): string {
  if (!token.workspace_name) return token.workspace_id;
  return `${token.workspace_name} (${token.workspace_id})`;
}

/**
 * Who the saved session is for, and whether the platform still accepts it:
 * the readiness read is the cheapest call a CLI token may make.
 */
export async function whoami(
  runtime: Runtime,
  options: GlobalOptions,
): Promise<void> {
  const credentials = await session(runtime, options);
  const provisioning = await cloudApi(credentials).workspaceProvisioning();
  const lang = options.lang;
  const phase =
    provisioning.phase === "ready"
      ? message("workspaceReady", lang)
      : provisioning.phase;
  result(
    runtime,
    options,
    "whoami",
    {
      workspace: credentials.workspace,
      apiUrl: credentials.apiUrl,
      consoleUrl: credentials.consoleUrl,
      provisioning: provisioning.phase,
    },
    () =>
      runtime.ui.details([
        {
          label: message("workspace", lang),
          value: `${credentials.workspace} (${phase})`,
        },
        { label: message("apiEndpoint", lang), value: credentials.apiUrl },
        { label: message("console", lang), value: credentials.consoleUrl },
      ]),
  );
}

/** Forgets the saved session on this machine. */
export async function logout(
  runtime: Runtime,
  options: GlobalOptions,
): Promise<void> {
  const wasLoggedIn = await deleteCredentials(runtime.configHome);
  feedback(runtime, options, {
    type: "logout",
    data: { wasLoggedIn },
    level: wasLoggedIn ? "success" : "skip",
    text: message(wasLoggedIn ? "loggedOut" : "alreadyLoggedOut", options.lang),
  });
}

/**
 * Refuses a link naming a service the project does not have, saying which
 * ones it has: without `--service`, `link` assumes the `api` and `app` layout
 * of a starter, and a project built otherwise must be told what to pass.
 */
function assertLinkableServices(
  project: Project,
  names: string[],
  lang?: string,
): void {
  const available = productionServices(project).map((service) => service.name);
  const missing = names.find((name) => !available.includes(name));
  if (missing === undefined) return;
  const listed = available.length
    ? available.join(", ")
    : message("noServices", lang);
  throw new CliError("unlinkable_service", {
    detail: missing,
    details: [`${message("availableServices", lang)} ${listed}`],
  });
}

export async function link(
  runtime: Runtime,
  options: GlobalOptions,
  projectName: string,
  linkOptions: LinkOptions,
): Promise<void> {
  const credentials = await session(runtime, options);
  const api = cloudApi(credentials);
  const projects = await api.listProjects();
  const project = projects.projects.find(
    (item) => item.id === projectName || item.slug === projectName,
  );
  if (!project) throw new CliError("unknown_project", projectName);
  const config: ProjectConfig = {
    workspace: credentials.workspace,
    project: project.id,
    services: withServiceDockerfiles(
      parseServicePaths(
        linkOptions.service.length ? linkOptions.service : DEFAULT_SERVICES,
      ),
      linkOptions.dockerfile,
    ),
  };
  const detail = await api.readProject(project.id);
  assertLinkableServices(detail, Object.keys(config.services), options.lang);
  await writeProjectConfig(runtime.cwd, config);
  feedback(runtime, options, {
    type: "project_linked",
    data: config,
    level: "success",
    text: `${message("linked", options.lang)}: ${project.slug}`,
  });
}

/**
 * The project's console page, or a service's public URL — its console page
 * when it has none.
 */
export async function open(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName?: string,
): Promise<void> {
  const { config, credentials, api } = await linkedContext(runtime, options);
  let url = consoleUrl(credentials.consoleUrl, "project", {
    project: config.project,
  });
  if (serviceName) {
    const service = serviceByName(
      await api.readProject(config.project),
      serviceName,
    );
    url =
      publicUrl(service) ??
      consoleUrl(credentials.consoleUrl, "service", {
        project: config.project,
        service: service.id,
      });
  }
  result(runtime, options, "open", { url }, () => runtime.ui.value(url));
  await openInBrowser(runtime, options, url);
}

export async function rollback(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
  revisionId?: string,
): Promise<void> {
  const { config, api } = await linkedContext(runtime, options);
  const service = serviceByName(
    await api.readProject(config.project),
    serviceName,
  );
  const history = await api.deploymentHistory(service.id);
  const revision = revisionId
    ? history.revisions.find((item) => item.id === revisionId)
    : history.revisions.find((item) => item.canRollback);
  if (!revision?.canRollback)
    throw new CliError("rollback_revision_unavailable", serviceName);
  const values = { service: serviceName, revision: String(revision.number) };
  const prompter = runtime.prompter({
    command: asInvoked(`ajs-cloud rollback ${serviceName}`),
    defaultsFlag: YES_FLAG,
  });
  const isConfirmed = await prompter.confirm({
    message: format("rollbackQuestion", options.lang, values),
    flag: YES_FLAG,
    answer: options.yes || undefined,
    defaultAnswer: false,
  });
  if (!isConfirmed) {
    feedback(runtime, options, {
      type: "rollback_declined",
      data: values,
      level: "skip",
      text: message("nothingChanged", options.lang),
    });
    return;
  }
  const rolledBack = await withTask(runtime, options, {
    label: format("rollingBack", options.lang, values),
    work: () => api.rollback(service.id, revision.id),
    done: format("rolledBack", options.lang, values),
  });
  if (options.json)
    record(runtime, "rollback_succeeded", {
      service: serviceName,
      revision: revision.id,
      result: rolledBack,
    });
}
