import { CliError } from "./errors.js";
import { isRecord, isString } from "./guards.js";

export const NETWORK_ERROR = "network_error";

/** A failed `fetch`: undici rejects with a `TypeError` carrying a cause. */
export function isFetchFailure(error: unknown): error is Error {
  return error instanceof TypeError && error.message === "fetch failed";
}

/** A request that never got an answer, raw or already explained. */
export function isNetworkFailure(cause: unknown): boolean {
  return (
    isFetchFailure(cause) ||
    (cause instanceof CliError && cause.code === NETWORK_ERROR)
  );
}

/**
 * Why the connection failed, as the system said it: `ECONNREFUSED`,
 * `ENOTFOUND`. A host with several addresses fails with one cause each.
 */
export function networkCause(error: Error): string | undefined {
  const cause = error.cause;
  if (!isRecord(cause)) return undefined;
  const errors: unknown = cause.errors;
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  const code = isString(cause.code) ? cause.code : undefined;
  const nestedCode =
    isRecord(first) && isString(first.code) ? first.code : undefined;
  const message = isString(cause.message) ? cause.message : undefined;
  return code ?? nestedCode ?? message;
}

/**
 * `fetch`, its network failures told with the endpoint that was tried and
 * the system's reason, instead of undici's bare "fetch failed".
 */
export function endpointFetch(apiUrl: string): typeof fetch {
  const endpoint = new URL(apiUrl).origin;
  return async (input, init) => {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (!isFetchFailure(error)) throw error;
      const cause = networkCause(error);
      throw new CliError(NETWORK_ERROR, {
        detail: endpoint,
        details: cause ? [cause] : [],
        cause: error,
      });
    }
  };
}
