import type {
  CloudApi,
  DeviceAuthorization,
  DeviceToken,
  SseEvent,
  WorkspaceProvisioning,
} from "@antelopejs/cloud-sdk";
import type { MessageLevel, MessageOptions } from "@antelopejs/core/cli";
import type { LogData } from "./logs.js";
import type { DeployPlan } from "./plan.js";
import type { ServiceStatus } from "./status.js";
import type {
  Credentials,
  GlobalOptions,
  ProjectConfig,
  Runtime,
} from "./types.js";

const OUTPUT_VERSION = 1;

type ApiResult<Method extends "createProject" | "createService" | "rollback"> =
  Awaited<ReturnType<CloudApi[Method]>>;

interface DeploymentRecord {
  service: string;
  deploymentId: string;
  url: string;
}

/** The `data` of each JSON Lines record `--json` writes, by record `type`. */
interface CliRecords {
  login_retrying: { attempt: number; retryInS: number };
  login_required: {
    verificationUrl: DeviceAuthorization["verification_uri_complete"];
    userCode: DeviceAuthorization["user_code"];
    expiresIn: DeviceAuthorization["expires_in"];
  };
  login_succeeded: {
    workspace: DeviceToken["workspace_id"];
    workspaceName: DeviceToken["workspace_name"];
  };
  whoami: Pick<Credentials, "workspace" | "apiUrl" | "consoleUrl"> & {
    provisioning: WorkspaceProvisioning["phase"];
  };
  logout: { wasLoggedIn: boolean };
  project_linked: ProjectConfig;
  project_not_linked: { cwd: string };
  project_created: ApiResult<"createProject">;
  service_created: ApiResult<"createService">;
  service_ceiling: { serviceId: string; ceiling: string };
  app_name_retry: { appName: string };
  open: { url: string };
  rollback_declined: { service: string; revision: string };
  rollback_succeeded: {
    service: string;
    revision: string;
    result: ApiResult<"rollback">;
  };
  deploy_plan: DeployPlan & { environment: string; source: string };
  deploy_declined: DeployPlan;
  deploy_started: { service: string };
  deploy_event: { service: string; event: SseEvent };
  deploy_detached: DeploymentRecord;
  deploy_timeout: DeploymentRecord;
  deploy_failed: DeploymentRecord & { status: string; reason: string | null };
  deploy_succeeded: {
    services: string[];
    urls: { [service: string]: string | null };
    durationMs: number;
  };
  workspace_not_ready: Pick<WorkspaceProvisioning, "phase" | "reasonCode">;
  workspace_ready: Pick<WorkspaceProvisioning, "phase">;
  log: LogData & { service: string; cursor: string | null };
  status: { project: string; services: ServiceStatus[] };
}

/** Writes one versioned JSON Lines record on stdout. */
export function record<Type extends keyof CliRecords>(
  runtime: Runtime,
  type: Type,
  data: CliRecords[Type],
): void {
  runtime.ui.value(JSON.stringify({ version: OUTPUT_VERSION, type, data }));
}

/**
 * Writes what a command produced: a JSON Lines record with `--json`,
 * otherwise what `render` writes on stdout through the Ui.
 */
export function result<Type extends keyof CliRecords>(
  runtime: Runtime,
  options: GlobalOptions,
  type: Type,
  data: CliRecords[Type],
  render: () => void,
): void {
  if (options.json) record(runtime, type, data);
  else render();
}

/** One step of a command: the record `--json` writes, or the message shown. */
type Feedback = {
  [Type in keyof CliRecords]: {
    type: Type;
    data: CliRecords[Type];
    level: MessageLevel;
    text: string;
    messageOptions?: MessageOptions;
  };
}[keyof CliRecords];

/**
 * Says how the command is going: a JSON Lines record with `--json`,
 * otherwise a message on stderr, which a quiet run leaves out unless it is a
 * warning.
 */
export function feedback(
  runtime: Runtime,
  options: GlobalOptions,
  { type, data, level, text, messageOptions }: Feedback,
): void {
  if (options.json) record(runtime, type, data);
  else runtime.ui.message(level, text, messageOptions);
}
