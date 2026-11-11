import createClient from "openapi-fetch";
import { CloudApiError, InvalidApiResponseError } from "./api-error.js";
import { ProjectDeploymentsApi } from "./deployments.js";
import { EnvironmentsApi, ProjectRepositoryApi } from "./environments.js";
import type { components, paths } from "./generated/cloud-api.js";
import { isRecord, isString } from "./guards.js";
import {
  acceptedOf,
  dataOf,
  errorCode,
  errorParams,
  isApiErrorBody,
  refusal,
} from "./result.js";
import { parseSse, type SseEvent } from "./sse.js";

/** What the API answers to an accepted source upload. */
export interface DeploymentReceipt {
  deploymentId: string;
  buildId: string;
  status: "queued";
}

export type DeviceAuthorization = components["schemas"]["DeviceAuthorization"];
export type DeviceToken = components["schemas"]["DeviceToken"];
export type EnvironmentVariable = components["schemas"]["EnvironmentVariable"];
export type EnvironmentVariableList =
  components["schemas"]["EnvironmentVariableList"];
export type NewProject = components["schemas"]["NewProject"];
export type NewUploadService = components["schemas"]["NewUploadService"];
export type VariableOrigin = components["schemas"]["VariableOrigin"];
export type VariableWrite = components["schemas"]["VariableWrite"];
export type WorkspaceProvisioning =
  components["schemas"]["WorkspaceProvisioning"];

/** The production Cloud API, used when no `baseUrl` is given. */
export const DEFAULT_API_URL = "https://api.antelopejs.cloud";

/** Where requests go and how they are sent, without a session. */
export interface EndpointOptions {
  /** The API origin, such as a test deployment. Defaults to {@link DEFAULT_API_URL}. */
  baseUrl?: string;
  /** Sends every request, in place of the global `fetch`. */
  fetch?: typeof fetch;
}

/** A client signed in with a token. */
export interface CloudApiOptions extends EndpointOptions {
  /** The bearer token a device login or the console issued. */
  token: string;
}

/** How a log read is shaped: one bounded page, or a tail from a cursor. */
export interface LogRequest {
  follow: boolean;
  lastEventId?: string;
  /** Called once the API accepted the read, before its first frame. */
  onOpen?: () => void;
}

const SOURCE_MIME_TYPE = "application/x-tar";
const SOURCE_FILENAME = "source.tar";
const HTTP_TOO_MANY_REQUESTS = 429;

function isDeploymentReceipt(value: unknown): value is DeploymentReceipt {
  return (
    isRecord(value) &&
    isString(value.deploymentId) &&
    isString(value.buildId) &&
    value.status === "queued"
  );
}

/** `Retry-After` as delta-seconds; the HTTP-date form, or nothing usable, is no hint. */
function retryAfterSeconds(header: string | null): number | undefined {
  if (!header || !/^\d+$/.test(header.trim())) return undefined;
  return Number(header.trim());
}

function endpointClient(options: EndpointOptions = {}) {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? DEFAULT_API_URL,
    fetch: options.fetch,
  });
}

/** The Cloud API, signed in with one token. Every refusal is a {@link CloudApiError}. */
export class CloudApi {
  private readonly client;
  private readonly baseUrl: string;
  private readonly send: typeof fetch;
  /** A project's environments: the branches Cloud builds and serves, their promotion and health. */
  readonly environments: EnvironmentsApi;
  /** The GitHub repository a project builds from. */
  readonly projectRepository: ProjectRepositoryApi;
  /** Every deployment of a project, newest first, one page at a time. */
  readonly projectDeployments: ProjectDeploymentsApi;

  constructor(private readonly options: CloudApiOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.send = options.fetch ?? fetch;
    this.client = createClient<paths>({
      baseUrl: this.baseUrl,
      headers: { Authorization: `Bearer ${options.token}` },
      fetch: options.fetch,
    });
    this.environments = new EnvironmentsApi(this.client);
    this.projectRepository = new ProjectRepositoryApi(this.client);
    this.projectDeployments = new ProjectDeploymentsApi(this.client);
  }

  async listProjects() {
    const result = await this.client.GET("/api/cloud/projects/");
    return dataOf(result);
  }

  async readProject(projectId: string) {
    const result = await this.client.GET("/api/cloud/projects/{projectId}", {
      params: { path: { projectId } },
    });
    return dataOf(result);
  }

  async workspaceProvisioning() {
    const result = await this.client.GET("/api/cloud/workspace-provisioning");
    return dataOf(result);
  }

  async readDeployment(deploymentId: string) {
    const result = await this.client.GET(
      "/api/cloud/deployments/{deploymentId}",
      { params: { path: { deploymentId } } },
    );
    return dataOf(result);
  }

  async onboardingState() {
    const result = await this.client.GET("/api/cloud/onboarding/");
    return dataOf(result);
  }

  async createProject(body: NewProject) {
    const result = await this.client.POST("/api/cloud/projects/", { body });
    return dataOf(result);
  }

  async createService(
    projectId: string,
    environmentId: string,
    body: NewUploadService,
  ) {
    const result = await this.client.POST(
      "/api/cloud/projects/{projectId}/environments/{environmentId}/services",
      { params: { path: { projectId, environmentId } }, body },
    );
    return dataOf(result);
  }

  async listVariables(projectId: string, environmentId: string) {
    const result = await this.client.GET(
      "/api/cloud/projects/{projectId}/environments/{environmentId}/variables",
      { params: { path: { projectId, environmentId } } },
    );
    return dataOf(result);
  }

  /** Secret values are write-only: the answer never carries one. */
  async setVariable(
    projectId: string,
    environmentId: string,
    serviceId: string,
    key: string,
    body: VariableWrite,
  ) {
    const result = await this.client.PUT(
      "/api/cloud/projects/{projectId}/environments/{environmentId}/services/{serviceId}/variables/{key}",
      {
        params: { path: { projectId, environmentId, serviceId, key } },
        body,
      },
    );
    return dataOf(result);
  }

  async deleteVariable(
    projectId: string,
    environmentId: string,
    serviceId: string,
    key: string,
  ): Promise<void> {
    const result = await this.client.DELETE(
      "/api/cloud/projects/{projectId}/environments/{environmentId}/services/{serviceId}/variables/{key}",
      {
        params: { path: { projectId, environmentId, serviceId, key } },
        parseAs: "text",
      },
    );
    acceptedOf(result);
  }

  /** The databases an environment runs, with their size, keep and cost. */
  async environmentResources(projectId: string, environmentId: string) {
    const result = await this.client.GET(
      "/api/cloud/projects/{projectId}/environments/{environmentId}/resources",
      { params: { path: { projectId, environmentId } } },
    );
    return dataOf(result);
  }

  /**
   * What applying the project's modules would do to an environment: the
   * databases to create, those that already serve a module, the needs Cloud
   * cannot provide, the monthly cost and the service limit.
   *
   * @param modules The npm package names of the modules in `antelope.config.ts`
   */
  async planResources(
    projectId: string,
    environmentId: string,
    modules: readonly string[],
  ) {
    const result = await this.client.POST(
      "/api/cloud/projects/{projectId}/environments/{environmentId}/resource-plan",
      {
        params: { path: { projectId, environmentId } },
        body: { modules: [...modules] },
      },
    );
    return dataOf(result);
  }

  /**
   * Creates the databases the modules need. The server computes the plan
   * again from the environment's state; it refuses with 409 before any write
   * when the plan would pass the environment's service limit.
   *
   * @param modules The npm package names of the modules in `antelope.config.ts`
   */
  async applyResources(
    projectId: string,
    environmentId: string,
    modules: readonly string[],
  ) {
    const result = await this.client.POST(
      "/api/cloud/projects/{projectId}/environments/{environmentId}/resource-plan/apply",
      {
        params: { path: { projectId, environmentId } },
        body: { modules: [...modules] },
      },
    );
    return dataOf(result);
  }

  async serviceSettings(serviceId: string) {
    const result = await this.client.GET(
      "/api/cloud/services/{serviceId}/settings",
      { params: { path: { serviceId } } },
    );
    return dataOf(result);
  }

  async deploymentHistory(serviceId: string) {
    const result = await this.client.GET(
      "/api/cloud/services/{serviceId}/deployments",
      {
        params: { path: { serviceId } },
      },
    );
    return dataOf(result);
  }

  async rollback(serviceId: string, revisionId: string) {
    const result = await this.client.POST(
      "/api/cloud/services/{serviceId}/deployments/{revisionId}/rollback",
      { params: { path: { serviceId, revisionId } } },
    );
    return dataOf(result);
  }

  /**
   * Uploads a service's source as one tar archive and queues its build.
   *
   * @throws {InvalidApiResponseError} when the API accepts it with another answer than a receipt
   */
  async deploy(
    serviceId: string,
    archive: Uint8Array,
  ): Promise<DeploymentReceipt> {
    const body = new FormData();
    body.append(
      "source",
      new Blob([new Uint8Array(archive)], { type: SOURCE_MIME_TYPE }),
      SOURCE_FILENAME,
    );
    const response = await this.raw(
      `/api/cloud/services/${encodeURIComponent(serviceId)}/source-deployments`,
      { method: "POST", body },
    );
    const receipt: unknown = await response.json();
    if (!isDeploymentReceipt(receipt)) throw new InvalidApiResponseError();
    return receipt;
  }

  progress(
    deploymentId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<SseEvent> {
    return this.stream(
      `/api/cloud/deployments/${encodeURIComponent(deploymentId)}/progress`,
      { Accept: "text/event-stream" },
      signal,
    );
  }

  logs(serviceId: string, request: LogRequest): AsyncGenerator<SseEvent> {
    const accept = { Accept: "text/event-stream" };
    const headers = request.lastEventId
      ? { ...accept, "Last-Event-ID": request.lastEventId }
      : accept;
    const query = request.follow ? "?follow=true" : "";
    return this.stream(
      `/api/cloud/services/${encodeURIComponent(serviceId)}/logs${query}`,
      headers,
      undefined,
      request.onOpen,
    );
  }

  private async raw(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.options.token}`);
    const response = await this.send(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (response.ok) return response;
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /** The response is already useful as plain text. */
    }
    throw refusal(
      response.status,
      isApiErrorBody(body) ? body : undefined,
      text,
    );
  }

  private async *stream(
    path: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    onOpen?: () => void,
  ): AsyncGenerator<SseEvent> {
    const response = await this.raw(path, { headers, signal });
    onOpen?.();
    yield* parseSse(response);
  }
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
  if (result.response.status === HTTP_TOO_MANY_REQUESTS) {
    const body = isApiErrorBody(result.error) ? result.error : undefined;
    throw new CloudApiError(
      result.response.status,
      errorCode(body),
      undefined,
      errorParams(body),
      retryAfterSeconds(result.response.headers.get("retry-after")),
    );
  }
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
