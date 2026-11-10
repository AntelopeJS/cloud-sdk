import { isString } from "./guards.js";

/** What a {@link CliError} carries besides its code. */
export interface CliErrorOptions {
  /** Replaces `{detail}` in the problem: a name, a path, a value. */
  detail?: string;
  /** Lines printed under the reason, such as the values to choose from. */
  details?: string[];
  cause?: unknown;
}

/**
 * A failure of the Cloud CLI, named by a stable code. Its text is chosen in
 * the user's language when it is reported (see `describeFailure`), and the
 * code travels as is in `--json` output.
 */
export class CliError extends Error {
  readonly detail?: string;
  readonly details: string[];

  constructor(
    readonly code: string,
    options: CliErrorOptions | string = {},
  ) {
    const parsed: CliErrorOptions = isString(options)
      ? { detail: options }
      : options;
    super(parsed.detail ? `${code}:${parsed.detail}` : code, {
      cause: parsed.cause,
    });
    this.name = "CloudCliError";
    this.detail = parsed.detail;
    this.details = parsed.details ?? [];
  }
}
