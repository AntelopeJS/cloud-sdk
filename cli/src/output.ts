import type { MessageLevel, MessageOptions } from "@antelopejs/core/cli";
import type { GlobalOptions, Runtime } from "./types.js";

const OUTPUT_VERSION = 1;

/** Writes one versioned JSON Lines record on stdout. */
export function record(
  runtime: Runtime,
  type: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON.stringify takes any value, and the callers pass interface-typed values (ProjectConfig, DeployPlan, ServiceStatus) and API payloads typed as string-keyed unknown, which a JSON value type rejects at six call sites
  data: unknown,
): void {
  runtime.ui.value(JSON.stringify({ version: OUTPUT_VERSION, type, data }));
}

/**
 * Writes what a command produced: a JSON Lines record with `--json`,
 * otherwise what `render` writes on stdout through the Ui.
 */
export function result(
  runtime: Runtime,
  options: GlobalOptions,
  type: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- passes the value on to record above, with the same callers
  data: unknown,
  render: () => void,
): void {
  if (options.json) record(runtime, type, data);
  else render();
}

/** One step of a command: the record `--json` writes, or the message shown. */
export interface Feedback {
  type: string;
  data: unknown;
  level: MessageLevel;
  text: string;
  messageOptions?: MessageOptions;
}

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
