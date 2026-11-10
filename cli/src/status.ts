import type { CloudApi } from "@antelopejs/cloud-sdk";
import { type MessageKey, message } from "./i18n.js";
import { result } from "./output.js";
import { TERMINAL_STATUSES } from "./progress.js";
import { productionServices, publicUrl, type Service } from "./project.js";
import { linkedContext } from "./session.js";
import type { GlobalOptions, Runtime } from "./types.js";

type DeploymentHistory = Awaited<ReturnType<CloudApi["deploymentHistory"]>>;
type ActiveBuild = NonNullable<DeploymentHistory["activeBuilds"]>[number];

/** A deployment still on its way to a service. */
interface InFlightDeployment {
  deploymentId: string;
  status: string;
  queuePosition: number | null;
}

/** One row of `status`. */
interface ServiceStatus {
  name: string;
  status: string;
  url: string | null;
  deployment: InFlightDeployment | null;
}

/** What `status` reports for a service no deployment ever shipped. */
const NOT_DEPLOYED_STATUS = "not_deployed";
const DEPLOYING_STATUS = "deploying";
const UNKNOWN_STATUS = "unknown";
const IN_FLIGHT_LABELS = new Map<string, MessageKey>([
  ["queued", "phaseQueued"],
  ["starting", "phaseBuilding"],
  ["running", "phaseBuilding"],
  ["building", "phaseBuilding"],
  ["checking", "phaseChecking"],
  ["switching", "phaseSwitching"],
]);
/** Revision states of an image built and still on its way to the service. */
const ROLLING_OUT_STATES = new Set(["preparing", "pending"]);
/** What a rollout is said to be doing when its deployment cannot be read. */
const ROLLOUT_STATUS = "checking";

/**
 * A service the platform knows nothing about and that was never deployed is
 * simply not deployed yet — the console says so, and so does the CLI — unless
 * its first deployment is on its way.
 */
function reportedStatus(
  service: Service,
  inFlight: InFlightDeployment | null,
): string {
  if (service.status !== UNKNOWN_STATUS || service.deployment) {
    return service.status;
  }
  return inFlight ? DEPLOYING_STATUS : NOT_DEPLOYED_STATUS;
}

/** Running builds first, then queued ones by their place in the queue. */
function buildRank(build: ActiveBuild): number {
  return build.queuePosition ?? 0;
}

function buildingDeployment(
  history: DeploymentHistory,
): InFlightDeployment | null {
  const build = [...(history.activeBuilds ?? [])].sort(
    (left, right) => buildRank(left) - buildRank(right),
  )[0];
  if (!build) return null;
  return {
    deploymentId: build.deploymentId,
    status: build.status,
    queuePosition: build.queuePosition,
  };
}

async function rolloutStatus(
  api: CloudApi,
  deploymentId: string,
): Promise<string> {
  try {
    return (await api.readDeployment(deploymentId)).status;
  } catch {
    return ROLLOUT_STATUS;
  }
}

/**
 * The deployment rolling out the newest revision once its build is over: a
 * deployment stuck in `checking` has no build left, and its revision is the
 * only trace of it in the history.
 */
async function rollingOutDeployment(
  api: CloudApi,
  history: DeploymentHistory,
): Promise<InFlightDeployment | null> {
  const newest = history.revisions[0];
  if (!newest?.deploymentId || !ROLLING_OUT_STATES.has(newest.state ?? ""))
    return null;
  const status = await rolloutStatus(api, newest.deploymentId);
  if (TERMINAL_STATUSES.has(status)) return null;
  return { deploymentId: newest.deploymentId, status, queuePosition: null };
}

/**
 * The deployment on its way to the service: its build closest to running,
 * else the rollout of a revision already built. The project read only knows
 * deployments that succeeded; a history the caller may not read just shows
 * none.
 */
async function inFlightDeployment(
  api: CloudApi,
  service: Service,
): Promise<InFlightDeployment | null> {
  try {
    const history = await api.deploymentHistory(service.id);
    return (
      buildingDeployment(history) ?? (await rollingOutDeployment(api, history))
    );
  } catch {
    return null;
  }
}

function inFlightLabel(inFlight: InFlightDeployment, lang?: string): string {
  const key = IN_FLIGHT_LABELS.get(inFlight.status);
  const phase = key ? message(key, lang) : inFlight.status;
  const position =
    inFlight.queuePosition === null
      ? ""
      : `, ${message("queuePosition", lang)} ${inFlight.queuePosition}`;
  return `${message("deployingNow", lang)} (${phase}${position})`;
}

function statusText(service: ServiceStatus, lang?: string): string {
  const labels = new Map<string, string>([
    [NOT_DEPLOYED_STATUS, message("notDeployed", lang)],
    [DEPLOYING_STATUS, message("deployingNow", lang)],
  ]);
  const label = labels.get(service.status) ?? service.status;
  if (!service.deployment) return label;
  const inFlight = inFlightLabel(service.deployment, lang);
  return service.status === DEPLOYING_STATUS
    ? inFlight
    : `${label}, ${inFlight}`;
}

async function serviceStatus(
  api: CloudApi,
  service: Service,
): Promise<ServiceStatus> {
  const deployment = await inFlightDeployment(api, service);
  return {
    name: service.name,
    status: reportedStatus(service, deployment),
    url: publicUrl(service),
    deployment,
  };
}

export async function status(
  runtime: Runtime,
  options: GlobalOptions,
): Promise<void> {
  const { config, api } = await linkedContext(runtime, options);
  const project = await api.readProject(config.project);
  const services = await Promise.all(
    productionServices(project).map((service) => serviceStatus(api, service)),
  );
  const lang = options.lang;
  result(runtime, options, "status", { project: project.slug, services }, () =>
    runtime.ui.table(services, [
      { header: message("columnService", lang), value: (row) => row.name },
      {
        header: message("columnStatus", lang),
        value: (row) => statusText(row, lang),
      },
      { header: message("columnUrl", lang), value: (row) => row.url ?? "-" },
    ]),
  );
}
