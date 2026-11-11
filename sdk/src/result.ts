import { type ApiErrorParams, CloudApiError } from "./api-error.js";
import { isObject, isRecord, isString } from "./guards.js";

interface ApiErrorFields {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  params?: unknown;
}

/** A refusal as the OpenAPI document names it: a code, or an object naming it. */
export type ApiErrorBody = string | ApiErrorFields;

/** What an `openapi-fetch` call settles to. */
export interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return isString(value) || isRecord(value);
}

export function errorCode(body: ApiErrorBody | undefined): string {
  if (isString(body)) return body;
  return [body?.code, body?.error, body?.message].find(isString) ?? "api_error";
}

/** The string values a `{ message, params }` refusal interpolates. */
export function errorParams(body: ApiErrorBody | undefined): ApiErrorParams {
  const params = isString(body) ? undefined : body?.params;
  if (!isObject(params)) return {};
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** `Retry-After` as delta-seconds; the HTTP-date form, or nothing usable, is no hint. */
function retryAfterSeconds(header: string | null): number | undefined {
  if (!header || !/^\d+$/.test(header.trim())) return undefined;
  return Number(header.trim());
}

/** The refusal a response carries, with the wait its `Retry-After` asks for. */
export function refusal(
  response: Response,
  body: ApiErrorBody | undefined,
  text?: string,
): CloudApiError {
  return new CloudApiError(
    response.status,
    errorCode(body),
    text,
    errorParams(body),
    retryAfterSeconds(response.headers.get("retry-after")),
  );
}

function refusalOf(result: ApiResult<unknown>): CloudApiError {
  return refusal(
    result.response,
    isApiErrorBody(result.error) ? result.error : undefined,
  );
}

/** The answer's body, or the refusal it carries. */
export function dataOf<T>(result: ApiResult<T>): T {
  if (!result.response.ok || result.error || result.data === undefined) {
    throw refusalOf(result);
  }
  return result.data;
}

/** For an answer that has no body: it only has to be accepted. */
export function acceptedOf(result: ApiResult<unknown>): void {
  if (!result.response.ok || result.error) throw refusalOf(result);
}
