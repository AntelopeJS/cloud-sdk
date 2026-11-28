import type { EnvironmentVariable, VariableWrite } from "@antelopejs/cloud-sdk";
import { CliError } from "./errors.js";
import type { EnvSetOptions } from "./types.js";

/** One variable as `env list` reports it: the API's row, with the name of its service. */
export interface VariableRow {
  service: string;
  serviceId: string;
  key: string;
  secret: boolean;
  /** The value in clear; null for a secret, or a wired value that is not available. */
  value: string | null;
  /** Also handed to the builds as a build argument, where its value is public. */
  buildTime: boolean;
  origin: EnvironmentVariable["origin"];
}

/** A `KEY=value` argument, split. */
export interface VariableAssignment {
  key: string;
  value: string;
}

/** The names a build argument may take: the upper-case form of a shell variable. */
const BUILD_ARGUMENT_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
/**
 * The names the build sets itself, and BuildKit's predefined proxy arguments,
 * which a build-time variable may not shadow; `BUILDKIT_*` steers BuildKit's
 * frontend and is kept out as well. The API refuses the same names.
 */
const RESERVED_BUILD_ARGUMENT_NAMES: ReadonlySet<string> = new Set([
  "BUILD_COMMAND",
  "NODE_ENV",
  "ANTELOPEJS_LAUNCH_ENV",
  "BUILD_DATE",
  "VCS_REF",
  "VERSION",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "FTP_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
]);
const BUILDKIT_ARGUMENT_PREFIX = "BUILDKIT_";
/** Code points, as the API counts them. */
const MAX_BUILD_ARGUMENT_VALUE_LENGTH = 1024;
/** A control character, line breaks and tabs included. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * Whether the API would accept a name as a build argument: the template's
 * alphabet, and not one the platform or BuildKit reserves.
 *
 * @param name The variable's name
 */
function isBuildArgumentName(name: string): boolean {
  return (
    BUILD_ARGUMENT_NAME_PATTERN.test(name) &&
    !RESERVED_BUILD_ARGUMENT_NAMES.has(name) &&
    !name.startsWith(BUILDKIT_ARGUMENT_PREFIX)
  );
}

/**
 * Whether the API would accept a value as a build argument: one line of at
 * most 1024 characters, without control characters.
 *
 * @param value The variable's value
 */
function isBuildArgumentValue(value: string): boolean {
  return (
    value.length > 0 &&
    !CONTROL_CHARACTER.test(value) &&
    Array.from(value).length <= MAX_BUILD_ARGUMENT_VALUE_LENGTH
  );
}

/**
 * A `KEY=value` argument split at its first `=`, so the value may hold one;
 * neither part may be empty. With `--build-time`, the name and the value are
 * held to the build-argument rules here, so a value the API would refuse is a
 * usage error and never a request. A refusal names the key, never the value,
 * which may be a secret.
 *
 * @param text The argument as typed
 * @param options The options of `env set`
 */
export function parseVariableAssignment(
  text: string,
  options: EnvSetOptions = {},
): VariableAssignment {
  const separator = text.indexOf("=");
  if (separator < 1 || separator === text.length - 1) {
    const shown = separator < 0 ? text : text.slice(0, separator);
    throw new CliError("invalid_variable_assignment", shown);
  }
  const key = text.slice(0, separator);
  const value = text.slice(separator + 1);
  if (options.buildTime === true) {
    if (!isBuildArgumentName(key)) {
      throw new CliError("invalid_build_time_name", key);
    }
    if (!isBuildArgumentValue(value)) {
      throw new CliError("invalid_build_time_value", key);
    }
  }
  return { key, value };
}

/**
 * The write `env set` sends: a secret unless `--plain` or `--build-time` says
 * otherwise (the API refuses the mark on a secret), the mark only when one of
 * `--build-time` and `--no-build-time` was given, so a held variable keeps its
 * own otherwise.
 *
 * @param assignment The variable and its value
 * @param options The options of `env set`
 */
export function variableWriteOf(
  assignment: VariableAssignment,
  options: EnvSetOptions,
): VariableWrite {
  const write: VariableWrite = { value: assignment.value };
  if (options.plain || options.buildTime === true) write.secret = false;
  if (options.buildTime !== undefined) write.buildTime = options.buildTime;
  return write;
}
