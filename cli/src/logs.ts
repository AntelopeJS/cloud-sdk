import { type CloudApi, CloudApiError } from "@antelopejs/cloud-sdk";
import { CliError } from "./errors.js";
import { isRecord, isString } from "./guards.js";
import { type MessageKey, message } from "./i18n.js";
import { isNetworkFailure } from "./network.js";
import { result } from "./output.js";
import { serviceByName } from "./project.js";
import { linkedContext } from "./session.js";
import type { GlobalOptions, LogsOptions, Runtime } from "./types.js";

const MAX_LOG_RECONNECT_DELAY_MS = 5_000;
const INITIAL_LOG_RECONNECT_DELAY_MS = 250;

/**
 * Every live stream slot is taken. Refusing a follow that was already live,
 * it is usually the slot that follow held on a replica that just stopped,
 * given back moments later: waited out from one second to thirty, each wait
 * drawn from the backoff's second half so the follows one replica dropped do
 * not all come back at once. Refusing a follow that never opened, it is the
 * answer.
 */
const TOO_MANY_REQUESTS_STATUS = 429;
const INITIAL_REFUSAL_DELAY_MS = 1_000;
const MAX_REFUSAL_DELAY_MS = 30_000;

interface LogData {
  at: string;
  level: string;
  message: string;
  instance: string | null;
}

interface LogStreamState {
  cursor?: string;
  didEnd: boolean;
}

/** What one read of the log stream is for. */
interface LogRead {
  runtime: Runtime;
  options: GlobalOptions;
  api: CloudApi;
  serviceId: string;
  serviceName: string;
  follow: boolean;
  /** Called each time the API accepts the read. */
  onOpen: () => void;
}

/** How a follow finds its way back: whether it was live, and a refusal's backoff. */
interface Reconnection {
  wasLive: boolean;
  refusalDelay: number | null;
}

function nextDelay(delay: number): number {
  return Math.min(delay * 2, MAX_LOG_RECONNECT_DELAY_MS);
}

function isTooManyRequests(error: unknown): error is CloudApiError {
  return (
    error instanceof CloudApiError && error.status === TOO_MANY_REQUESTS_STATUS
  );
}

/** The wait before retrying a refused reconnect, drawn from its backoff's second half. */
function refusalWait(reconnection: Reconnection): number {
  const backoff =
    reconnection.refusalDelay === null
      ? INITIAL_REFUSAL_DELAY_MS
      : Math.min(reconnection.refusalDelay * 2, MAX_REFUSAL_DELAY_MS);
  reconnection.refusalDelay = backoff;
  return backoff / 2 + Math.random() * (backoff / 2);
}

/**
 * Prints the service's recent logs, or — with `--follow` — tails them,
 * reconnecting from the last cursor whenever the stream drops.
 */
export async function logs(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
  logsOptions: LogsOptions = {},
): Promise<void> {
  const { config, api } = await linkedContext(runtime, options);
  const service = serviceByName(
    await api.readProject(config.project),
    serviceName,
  );
  const reconnection: Reconnection = { wasLive: false, refusalDelay: null };
  const read: LogRead = {
    runtime,
    options,
    api,
    serviceId: service.id,
    serviceName,
    follow: logsOptions.follow === true,
    onOpen: () => {
      reconnection.wasLive = true;
      reconnection.refusalDelay = null;
    },
  };
  let cursor: string | undefined;
  let reconnectDelay = INITIAL_LOG_RECONNECT_DELAY_MS;
  while (true) {
    let state: LogStreamState | null;
    try {
      state = await retryableLogStream(
        () => streamLogsOnce(read, cursor),
        runtime,
        reconnectDelay,
      );
    } catch (error) {
      if (!read.follow || !(reconnection.wasLive && isTooManyRequests(error)))
        throw error;
      await runtime.sleep(refusalWait(reconnection));
      continue;
    }
    reconnectDelay = nextDelay(reconnectDelay);
    if (!state) continue;
    if (state.didEnd || !read.follow) return;
    cursor = state.cursor;
    await runtime.sleep(reconnectDelay);
  }
}

async function retryableLogStream(
  stream: () => Promise<LogStreamState>,
  runtime: Runtime,
  delay: number,
): Promise<LogStreamState | null> {
  try {
    return await stream();
  } catch (error) {
    const isFatal =
      error instanceof CloudApiError ||
      (error instanceof CliError && !isNetworkFailure(error));
    if (isFatal) throw error;
    await runtime.sleep(delay);
    return null;
  }
}

/** Log events that close the stream, and what a person is told then. */
const CLOSING_LOG_EVENTS = new Map<string, MessageKey | null>([
  ["end", null],
  ["not_deployed", "logsNotDeployed"],
]);

async function streamLogsOnce(
  read: LogRead,
  cursor?: string,
): Promise<LogStreamState> {
  const { runtime, options } = read;
  const request = {
    follow: read.follow,
    lastEventId: cursor,
    onOpen: read.onOpen,
  };
  let count = 0;
  for await (const event of read.api.logs(read.serviceId, request)) {
    if (event.event === "error")
      throw new CliError("log_stream_error", JSON.stringify(event.data));
    if (CLOSING_LOG_EVENTS.has(event.event)) {
      const key = CLOSING_LOG_EVENTS.get(event.event);
      const notice = key ?? (count === 0 && !read.follow ? "logsEmpty" : null);
      if (notice && !options.json)
        runtime.ui.message("info", message(notice, options.lang));
      return { cursor, didEnd: true };
    }
    if (event.event !== "log") continue;
    const log = event.data;
    if (!isLogData(log)) throw new CliError("invalid_log_event");
    cursor = event.id ?? cursor;
    count += 1;
    result(
      runtime,
      options,
      "log",
      { service: read.serviceName, ...log, cursor: event.id ?? null },
      () => runtime.ui.value(`${log.at} ${log.level} ${log.message}`),
    );
  }
  return { cursor, didEnd: false };
}

function isLogData(value: unknown): value is LogData {
  return (
    isRecord(value) &&
    isString(value.at) &&
    isString(value.level) &&
    isString(value.message) &&
    (isString(value.instance) || value.instance === null)
  );
}
