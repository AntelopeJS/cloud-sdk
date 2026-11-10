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

export function refusal(
  status: number,
  body: ApiErrorBody | undefined,
  text?: string,
): CloudApiError {
  return new CloudApiError(status, errorCode(body), text, errorParams(body));
}

function refusalOf(result: ApiResult<unknown>): CloudApiError {
  return refusal(
    result.response.status,
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
