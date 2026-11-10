import { resolve } from "node:path";
import {
  type CloudApi,
  CloudApiError,
  InvalidApiResponseError,
  type SseEvent,
} from "@antelopejs/cloud-sdk";
import { cloudApi } from "./api.js";
import { createSourceArchive } from "./archive.js";
import { locateProjectRoot, readProjectConfig } from "./config.js";
import { consoleUrl } from "./console-urls.js";
import { CliError } from "./errors.js";
import { createFirstDeployment } from "./first-deploy.js";
import { message } from "./i18n.js";
import { record } from "./output.js";
import { DeployProgress, progressData, TERMINAL_STATUSES } from "./progress.js";
import {
  backendsFirst,
  type Project,
  publicUrl,
  resolveServiceRoot,
  type Service,
  selectedServiceNames,
  serviceByName,
} from "./project.js";
import { linkedContext, session } from "./session.js";
import type {
  Credentials,
  DeployOptions,
  GlobalOptions,
  ProjectConfig,
  Runtime,
} from "./types.js";
import { timeoutOf } from "./validation.js";
import { ensureWorkspaceReady } from "./workspace.js";

/** Times a progress stream that closed early is reopened before giving up. */
const MAX_STREAM_RECONNECTS = 3;
const STREAM_RECONNECT_DELAY_MS = 1_000;
const SUCCEEDED = "succeeded";
const FAILED = "failed";
const HINT_GAP = 2;
const YES_FLAG = "--yes";

/** What `deploy` works on once the folder is linked and the workspace ready. */
interface DeployRun {
  runtime: Runtime;
  options: GlobalOptions;
  api: CloudApi;
  credentials: Credentials;
  root: string;
  config: ProjectConfig;
  project: Project;
  timeoutMs: number;
}

/** One deployment being followed. */
interface Followed {
  service: Service;
  deploymentId: string;
  progress: DeployProgress;
}

interface DeployedService {
  name: string;
  url: string | null;
}

function deploymentPage(run: DeployRun, followed: Followed): string {
  return consoleUrl(run.credentials.consoleUrl, "deployment", {
    project: run.config.project,
    service: followed.service.id,
    deployment: followed.deploymentId,
  });
}

/**
 * Ctrl+C stops the CLI, not the deployment: say so, and how to find it
 * again, instead of exiting silently.
 */
function detach(run: DeployRun, followed: Followed): void {
  followed.progress.stop();
  const name = followed.service.name;
  const url = deploymentPage(run, followed);
  if (run.options.json) {
    record(run.runtime, "deploy_detached", {
      service: name,
      deploymentId: followed.deploymentId,
      url,
    });
    return;
  }
  const lang = run.options.lang;
  const hints: [string, string][] = [
    ["ajs-cloud status", message("detachedStatus", lang)],
    [`ajs-cloud logs ${name} -f`, message("detachedLogs", lang)],
  ];
  const width =
    Math.max(...hints.map(([command]) => command.length)) + HINT_GAP;
  run.runtime.ui.message("warn", message("detached", lang), {
    details: [
      ...hints.map(([command, hint]) => `${command.padEnd(width)}${hint}`),
      `${message("detachedConsole", lang)} ${url}`,
    ],
  });
}

/**
 * Reads one progress stream until the deployment ends or the stream closes.
 * The terminal status, or null when the stream closed first — the server
 * closes it on its own restarts and on revoked access.
 */
async function readProgress(
  run: DeployRun,
  followed: Followed,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    for await (const event of run.api.progress(followed.deploymentId, signal)) {
      showEvent(run, followed, event);
      const status = progressData(event).status;
      if (status && TERMINAL_STATUSES.has(status)) return status;
      if (event.event === "error") return null;
    }
  } catch (error) {
    if (signal.aborted || error instanceof CloudApiError) throw error;
    return null;
  }
  return null;
}

function showEvent(run: DeployRun, followed: Followed, event: SseEvent): void {
  followed.progress.update(event);
  if (!run.options.json) return;
  record(run.runtime, "deploy_event", {
    service: followed.service.name,
    event,
  });
}

/**
 * Follows a deployment to its end, reopening a stream that closed early, and
 * stops waiting — not the deployment — once `timeoutMs` has passed.
 */
async function follow(run: DeployRun, followed: Followed): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), run.timeoutMs);
  try {
    for (let attempt = 0; attempt <= MAX_STREAM_RECONNECTS; attempt += 1) {
      if (attempt > 0) await run.runtime.sleep(STREAM_RECONNECT_DELAY_MS);
      const status = await readProgress(run, followed, controller.signal);
      if (status) return status;
    }
    throw new CliError("deployment_stream_ended", followed.service.name);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    throw timedOut(run, followed);
  } finally {
    clearTimeout(timer);
  }
}

function timedOut(run: DeployRun, followed: Followed): CliError {
  const summary = followed.progress.summary();
  followed.progress.stop();
  const url = deploymentPage(run, followed);
  const service = followed.service.name;
  if (run.options.json)
    record(run.runtime, "deploy_timeout", {
      service,
      deploymentId: followed.deploymentId,
      url,
    });
  return new CliError("deployment_timeout", {
    detail: service,
    details: [summary, url],
  });
}

/**
 * Why a deployment failed, when the platform recorded it: the deployment's
 * own failure, else why its build failed, with a hint to retry when the
 * platform failed rather than the source. Never fatal.
 */
async function failureOf(run: DeployRun, deploymentId: string) {
  try {
    const detail = await run.api.readDeployment(deploymentId);
    if (detail.failure?.key) return detail.failure.key;
    const reason = detail.builds?.find(
      (build) => build.failureReason,
    )?.failureReason;
    if (!reason) return null;
    const retry = reason.platform
      ? ` (${message("platformFailure", run.options.lang)})`
      : "";
    return `${reason.summary}${retry}`;
  } catch {
    return null;
  }
}

async function reportFailure(
  run: DeployRun,
  followed: Followed,
  status: string,
): Promise<CliError> {
  const reason =
    status === FAILED ? await failureOf(run, followed.deploymentId) : null;
  const url = deploymentPage(run, followed);
  const service = followed.service.name;
  if (run.options.json)
    record(run.runtime, "deploy_failed", {
      service,
      deploymentId: followed.deploymentId,
      status,
      reason,
      url,
    });
  const because = reason
    ? [`${message("failureReason", run.options.lang)} ${reason}`]
    : [];
  return new CliError(`deployment_${status}`, {
    detail: service,
    details: [...because, url],
  });
}

async function uploadAndFollow(
  run: DeployRun,
  service: Service,
  progress: DeployProgress,
): Promise<void> {
  const { path, dockerfile } = run.config.services[service.name];
  const sourceRoot = await resolveServiceRoot(run.root, path);
  const archive = await createSourceArchive(sourceRoot, dockerfile);
  const receipt = await run.api
    .deploy(service.id, archive)
    .catch((error: unknown) => {
      if (error instanceof InvalidApiResponseError)
        throw new CliError(error.code, { cause: error });
      throw error;
    });
  const followed: Followed = {
    service,
    deploymentId: receipt.deploymentId,
    progress,
  };
  const stopListening = run.runtime.onInterrupt(() => detach(run, followed));
  progress.update({ event: "state", data: { status: receipt.status } });
  try {
    const status = await follow(run, followed);
    if (status !== SUCCEEDED) throw await reportFailure(run, followed, status);
  } finally {
    stopListening();
  }
}

async function deployOne(
  run: DeployRun,
  serviceName: string,
): Promise<DeployedService> {
  const service = serviceByName(run.project, serviceName);
  if (run.options.json)
    record(run.runtime, "deploy_started", { service: serviceName });
  const progress = new DeployProgress(
    run.runtime,
    run.options,
    serviceName,
    run.runtime.now(),
  );
  progress.start();
  try {
    await uploadAndFollow(run, service, progress);
  } finally {
    progress.stop();
  }
  return { name: serviceName, url: publicUrl(service) };
}

/**
 * Whether `deploy` works from the nearest link. A folder below it that is
 * none of its services' own, named with `--project`, is deployed on its own
 * instead: the first deployment links it, and the nearest link is then its.
 */
async function deploysFromLink(
  runtime: Runtime,
  deployOptions: DeployOptions,
): Promise<boolean> {
  const root = await locateProjectRoot(runtime.cwd);
  if (root === null) return false;
  const cwd = resolve(runtime.cwd);
  if (!deployOptions.project || root === cwd) return true;
  const { services } = await readProjectConfig(root);
  return Object.values(services).some(
    (service) => resolve(root, service.path) === cwd,
  );
}

/**
 * The link `deploy` works from: the folder's own, or — for a folder never
 * linked — the one a first deployment creates along with the project. Either
 * way the workspace must be able to build before anything is created or
 * uploaded.
 */
async function prepare(
  runtime: Runtime,
  options: GlobalOptions,
  deployOptions: DeployOptions,
  requested?: string,
) {
  const credentials = await session(runtime, options);
  const linked = (await deploysFromLink(runtime, deployOptions))
    ? await linkedContext(runtime, options, credentials)
    : null;
  if (linked) {
    await ensureWorkspaceReady(runtime, options, linked.api);
    return { ...linked, requested };
  }
  const api = cloudApi(credentials);
  const prompter = runtime.prompter({
    command: "ajs-cloud deploy",
    acceptsDefaults: options.yes === true,
    defaultsFlag: YES_FLAG,
  });
  const created = await createFirstDeployment(
    { runtime, options, deployOptions, api, credentials, prompter },
    requested,
  );
  if (!created) return null;
  return { ...created, credentials, api, requested: created.service };
}

function succeeded(
  run: DeployRun,
  deployed: DeployedService[],
  durationMs: number,
): void {
  const names = deployed.map((service) => service.name);
  const urls = Object.fromEntries(
    deployed.map((item) => [item.name, item.url]),
  );
  if (run.options.json) {
    record(run.runtime, "deploy_succeeded", {
      services: names,
      urls,
      durationMs,
    });
    return;
  }
  const lang = run.options.lang;
  const [first] = names;
  run.runtime.ui.summary({
    headline: `${message("deployed", lang)} ${names.join(", ")}`,
    durationMs,
    nextSteps: [
      {
        command: "ajs-cloud status",
        description: message("detachedStatus", lang),
      },
      {
        command: `ajs-cloud logs ${first} -f`,
        description: message("detachedLogs", lang),
      },
    ],
  });
  deployed.forEach((item) => {
    if (item.url) run.runtime.ui.value(item.url);
  });
}

export async function deploy(
  runtime: Runtime,
  options: GlobalOptions,
  requested?: string,
  deployOptions: DeployOptions = {},
): Promise<void> {
  const timeoutMs = timeoutOf(deployOptions.timeout);
  const target = await prepare(runtime, options, deployOptions, requested);
  if (!target) return;
  const startedAt = runtime.now();
  const run: DeployRun = {
    runtime,
    options,
    timeoutMs,
    api: target.api,
    credentials: target.credentials,
    root: target.root,
    config: target.config,
    project: await target.api.readProject(target.config.project),
  };
  const names = backendsFirst(
    run.project,
    selectedServiceNames(run.config, run.root, runtime.cwd, target.requested),
  );
  const deployed: DeployedService[] = [];
  for (const name of names) deployed.push(await deployOne(run, name));
  succeeded(run, deployed, runtime.now() - startedAt);
}
