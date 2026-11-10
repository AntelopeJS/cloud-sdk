/** Values an API error message interpolates, by name. */
export type ApiErrorParams = Readonly<Record<string, string>>;

/** A request the Cloud API answered with an error status. */
export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    body?: string,
    /** Values the refusal names, such as the Node.js versions it supports. */
    readonly params: ApiErrorParams = {},
    /** Seconds the API asked to wait (`Retry-After`), when it sent them. */
    readonly retryAfterS?: number,
  ) {
    super(body || code);
  }
}

/** An answer the API accepted a request with, in a shape this client cannot read. */
export class InvalidApiResponseError extends Error {
  readonly code = "invalid_api_response";

  constructor() {
    super("invalid_api_response");
    this.name = "InvalidApiResponseError";
  }
}
