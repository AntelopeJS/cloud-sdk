import { DEFAULT_DEPLOY_TIMEOUT_MINUTES } from "./constants.js";
import { CliError } from "./errors.js";
import {
  isValidPort,
  isValidProjectSlug,
  isValidServiceName,
} from "./naming.js";
import { parseServicePaths, withServiceDockerfiles } from "./project.js";
import type { DeployOptions, GlobalOptions, LinkOptions } from "./types.js";

const MINUTE_MS = 60_000;
const PORT_PATTERN = /^\d+$/;
const WEB_PROTOCOLS = ["http:", "https:"];

/**
 * The API URL without its trailing slash, refused when it is not a plain
 * http(s) URL: a token is never sent with credentials, a query or a fragment
 * someone else chose.
 */
/**
 * An URL as it may be shown back: without the credentials, query or fragment
 * that make it invalid, since they may be secrets.
 */
function shownUrl(url: URL): string {
  const shown = new URL(url.href);
  shown.username = "";
  shown.password = "";
  shown.search = "";
  shown.hash = "";
  return shown.href;
}

export function normalizedApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("invalid_api_url", value);
  }
  const isPlain =
    WEB_PROTOCOLS.includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash;
  if (!isPlain) throw new CliError("invalid_api_url", shownUrl(url));
  return url.href.replace(/\/$/, "");
}

/** Milliseconds to follow a deployment, from `--timeout` in minutes. */
export function timeoutOf(value: string | undefined): number {
  const minutes = Number(value ?? DEFAULT_DEPLOY_TIMEOUT_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new CliError("invalid_timeout", value);
  return minutes * MINUTE_MS;
}

/** Whether a port given as text is a whole number from 1 to 65535. */
export function isValidPortText(value: string): boolean {
  return PORT_PATTERN.test(value) && isValidPort(Number(value));
}

/** Fails before any work on a global option no command could use. */
export function validateGlobalOptions(options: GlobalOptions): void {
  if (options.apiUrl !== undefined) normalizedApiUrl(options.apiUrl);
}

/**
 * Fails before any request on a value `deploy` would only refuse after
 * reading the session, the link and the project.
 */
export function validateDeployArguments(
  service: string | undefined,
  options: DeployOptions,
): void {
  timeoutOf(options.timeout);
  if (options.port !== undefined && !isValidPortText(options.port))
    throw new CliError("invalid_port", options.port);
  if (options.project !== undefined && !isValidProjectSlug(options.project))
    throw new CliError("invalid_project_slug", options.project);
  if (service !== undefined && !isValidServiceName(service))
    throw new CliError("invalid_service_name", service);
}

export function validateLinkOptions(options: LinkOptions): void {
  withServiceDockerfiles(
    parseServicePaths(options.service),
    options.dockerfile,
  );
}
