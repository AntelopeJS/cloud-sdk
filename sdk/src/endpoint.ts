import createClient from "openapi-fetch";
import type { components, paths } from "./generated/cloud-api.js";
import { dataOf } from "./result.js";

export type DeviceAuthorization = components["schemas"]["DeviceAuthorization"];
export type DeviceToken = components["schemas"]["DeviceToken"];

/** The production Cloud API, used when no `baseUrl` is given. */
export const DEFAULT_API_URL = "https://api.antelopejs.cloud";

/** Where requests go and how they are sent, without a session. */
export interface EndpointOptions {
  /** The API origin, such as a test deployment. Defaults to {@link DEFAULT_API_URL}. */
  baseUrl?: string;
  /** Sends every request, in place of the global `fetch`. */
  fetch?: typeof fetch;
}

function endpointClient(options: EndpointOptions = {}) {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? DEFAULT_API_URL,
    fetch: options.fetch,
  });
}

/**
 * Starts a device login (RFC 8628): the codes a person approves in the console.
 *
 * @param deviceName How the console names the device asking for a token
 * @throws {CloudApiError} carrying `retryAfterS` when the API rate-limits logins
 */
export async function createDevice(
  deviceName: string,
  options?: EndpointOptions,
): Promise<DeviceAuthorization> {
  const result = await endpointClient(options).POST("/api/cloud/cli/device", {
    body: { device_name: deviceName },
  });
  return dataOf(result);
}

/**
 * Trades an approved device code for a token. Until a person approves it,
 * the API refuses with `authorization_pending` or `slow_down`.
 */
export async function exchangeDevice(
  deviceCode: string,
  options?: EndpointOptions,
): Promise<DeviceToken> {
  const result = await endpointClient(options).POST("/api/cloud/cli/token", {
    body: { device_code: deviceCode },
  });
  return dataOf(result);
}
