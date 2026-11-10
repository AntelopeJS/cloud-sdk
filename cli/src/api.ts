import {
  CloudApi,
  createDevice,
  type DeviceAuthorization,
  type DeviceToken,
  exchangeDevice,
} from "@antelopejs/cloud-sdk";
import { endpointFetch } from "./network.js";
import type { Credentials } from "./types.js";

/** How the console names a device the CLI logs in. */
const DEVICE_NAME = "AntelopeJS CLI";

/** The API client of a saved session, its network failures told with the endpoint. */
export function cloudApi(credentials: Credentials): CloudApi {
  return new CloudApi({
    baseUrl: credentials.apiUrl,
    token: credentials.token,
    fetch: endpointFetch(credentials.apiUrl),
  });
}

/** Starts a device login against `apiUrl`. */
export function requestDeviceCode(
  apiUrl: string,
): Promise<DeviceAuthorization> {
  return createDevice(DEVICE_NAME, {
    baseUrl: apiUrl,
    fetch: endpointFetch(apiUrl),
  });
}

/** Trades an approved device code from `apiUrl` for a token. */
export function exchangeDeviceCode(
  apiUrl: string,
  deviceCode: string,
): Promise<DeviceToken> {
  return exchangeDevice(deviceCode, {
    baseUrl: apiUrl,
    fetch: endpointFetch(apiUrl),
  });
}
