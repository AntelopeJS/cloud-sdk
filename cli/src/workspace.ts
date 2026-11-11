import {
  type CloudApi,
  CloudApiError,
  type WorkspaceProvisioning,
} from "@antelopejs/cloud-sdk";
import { CliError } from "./errors.js";
import { message } from "./i18n.js";
import { record } from "./output.js";
import { withTask } from "./tasks.js";
import type { GlobalOptions, Runtime } from "./types.js";

/** How often a workspace being prepared is asked again. */
const WORKSPACE_POLL_INTERVAL_MS = 5_000;
/**
 * How long a deploy waits for a new workspace. Provisioning takes about a
 * minute; past a few, something needs a person rather than a longer wait.
 */
export const WORKSPACE_WAIT_MS = 3 * 60_000;

const READY_PHASE = "ready";
const PREPARING_PHASES = new Set(["pending", "reconciling"]);
const CLOSED_PHASES = new Set(["revoking", "revoked"]);
const NOT_FOUND_STATUS = 404;

/** A platform without the readiness route predates the check: deploy on. */
async function readProvisioning(
  api: CloudApi,
): Promise<WorkspaceProvisioning | null> {
  try {
    return await api.workspaceProvisioning();
  } catch (error) {
    if (error instanceof CloudApiError && error.status === NOT_FOUND_STATUS)
      return null;
    throw error;
  }
}

function refusal(state: WorkspaceProvisioning): CliError {
  if (CLOSED_PHASES.has(state.phase)) return new CliError("workspace_closed");
  if (PREPARING_PHASES.has(state.phase))
    return new CliError("workspace_not_ready");
  return new CliError("workspace_blocked", state.reasonCode ?? state.phase);
}

/** Polls a workspace being prepared until it is not, or the wait is over. */
async function waitWhilePreparing(
  runtime: Runtime,
  api: CloudApi,
  initial: WorkspaceProvisioning,
): Promise<WorkspaceProvisioning> {
  const deadline = runtime.now() + WORKSPACE_WAIT_MS;
  let state = initial;
  while (PREPARING_PHASES.has(state.phase) && runtime.now() < deadline) {
    await runtime.sleep(WORKSPACE_POLL_INTERVAL_MS);
    state = (await readProvisioning(api)) ?? { ...state, phase: READY_PHASE };
  }
  if (state.phase !== READY_PHASE) throw refusal(state);
  return state;
}

/**
 * Makes sure the workspace can build before `deploy` creates or uploads
 * anything. A workspace still being prepared — a new one, for about a minute
 * — is waited for as a task; one that is blocked or closed is explained and
 * stops the command, so nothing is created that could not be deployed.
 */
export async function ensureWorkspaceReady(
  runtime: Runtime,
  options: GlobalOptions,
  api: CloudApi,
): Promise<void> {
  const state = await readProvisioning(api);
  if (state === null || state.phase === READY_PHASE) return;
  if (!PREPARING_PHASES.has(state.phase)) throw refusal(state);
  if (options.json)
    record(runtime, "workspace_not_ready", {
      phase: state.phase,
      reasonCode: state.reasonCode,
    });
  const ready = await withTask(runtime, options, {
    label: message("workspacePreparing", options.lang),
    work: () => waitWhilePreparing(runtime, api, state),
    done: message("workspaceNowReady", options.lang),
  });
  if (options.json) record(runtime, "workspace_ready", { phase: ready.phase });
}
