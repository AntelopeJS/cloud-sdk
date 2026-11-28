import createClient from "openapi-fetch";
import { InvalidApiResponseError } from "./api-error.js";
import { ProjectDeploymentsApi } from "./deployments.js";
import { DEFAULT_API_URL, type EndpointOptions } from "./endpoint.js";
import { EnvironmentsApi, ProjectRepositoryApi } from "./environments.js";
import type { components, paths } from "./generated/cloud-api.js";
import { isRecord, isString } from "./guards.js";
import { type BuildLogRequest, type LogRequest, logReadOf } from "./logs.js";
import {
  acceptedOf,
  dataOf,
  isApiErrorBody,
  refusal,
  type ApiErrorBody,
} from "./result.js";
import { parseSse, type SseEvent } from "./sse.js";

/** What the API answers to an accepted source upload. */
export interface DeploymentReceipt {
  deploymentId: string;
  buildId: string;
  status: "queued";
}

export type EnvironmentVariable = components["schemas"]["EnvironmentVariable"];
export type EnvironmentVariableList =
  components["schemas"]["EnvironmentVariableList"];
export type NewProject = components["schemas"]["NewProject"];
/** A service to create: one each `ajs cloud deploy` uploads, or one built from a repository. */
export type NewService = components["schemas"]["NewService"];
/** A service whose deployments each carry their own uploaded source. */
export type NewUploadService = NewService & { source: { type: "upload" } };
/** A service AntelopeJS Cloud builds from a repository at each push. */
export type NewRepositoryService = NewService & {
  source: { type: "repository" };
};
/** Where a service's deployments come from, as `setServiceSource` writes it. */
export type ServiceSource = components["schemas"]["ServiceSource"];
export type VariableOrigin = components["schemas"]["VariableOrigin"];
export type VariableWrite = components["schemas"]["VariableWrite"];
export type WorkspaceProvisioning =
  components["schemas"]["WorkspaceProvisioning"];

/** A client signed in with a token. */
export interface CloudApiOptions extends EndpointOptions {
  /** The bearer token a device login or the console issued. */
  token: string;
}

/** How a project create is sent. */
export interface CreateProjectOptions {
  /**
   * Identifies this create across retries, 1 to 255 visible ASCII characters.
   * Scoped to the workspace and to the member who sends it.
   */
  idempotencyKey?: string;
}

/** A value a service publishes to the other services of its environment. */
export interface PublishedValue {
  /** The service that publishes the value. */
  serviceId: string;
  /** The key it publishes the value under. */
  publishedKey: string;
}

const SOURCE_MIME_TYPE = "application/x-tar";
const SOURCE_FILENAME = "source.tar";

function isDeploymentReceipt(value: unknown): value is DeploymentReceipt {
  return (
    isRecord(value) &&
    isString(value.deploymentId) &&
    isString(value.buildId) &&
    value.status === "queued"
  );
}

function errorBodyOf(text: string): ApiErrorBody | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isApiErrorBody(parsed) ? parsed : undefined;
  } catch {
    return text;
  }
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

  /**
   * Creates a project. A retry by the same member with the same
   * `idempotencyKey` and the same body answers the project that key created
   * instead of a second one; the same key with another body is refused with
   * `cloud.errors.projects.idempotency_key_reused`, and
   * `cloud.errors.projects.creation_in_progress` asks for a retry with the
   * same key.
   */
  async createProject(body: NewProject, options: CreateProjectOptions = {}) {
    const result = await this.client.POST("/api/cloud/projects/", {
      body,
      params: { header: { "Idempotency-Key": options.idempotencyKey } },
    });
    return dataOf(result);
  }

  /**
   * Creates a service in an environment. With a `repository` source it builds
   * that repository at each push to the environment's branch, with the
   * Dockerfile its `dockerfilePath` names when it has one: that is how a
   * second service, such as a dashboard built by `frontend.Dockerfile`, is
   * built from the repository of the first. In a monorepo, `rootPath` names
   * the folder the service builds from, and `sharedPaths` the paths outside
   * it a push rebuilds the service for.
   */
  async createService(
    projectId: string,
    environmentId: string,
    body: NewService,
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

  /**
   * Sets a variable of a service and answers it as listed. Secret values are
   * write-only: the answer never carries one. `buildTime: true` also hands a
   * visible value to the service's builds as a build argument (`NEXT_PUBLIC_*`,
   * `VITE_*`); that value is public, written into the image. A new variable
   * needs `secret: false` with it; a secret is refused with
   * `cloud.errors.settings.entry.build_time_secret`, a reserved or lower-case
   * name with `cloud.errors.settings.entry.build_time_name`.
   */
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

  /**
   * Sets the port the service's container listens on, from 1024 to 65535, or
   * clears it with null. A service created from a repository has none, and is
   * refused its deployments until it has one. The running revision keeps its
   * port; the next deployment takes the new one.
   */
  async setServicePort(serviceId: string, port: number | null): Promise<void> {
    const result = await this.client.PUT(
      "/api/cloud/services/{serviceId}/port",
      { params: { path: { serviceId } }, body: { port }, parseAs: "text" },
    );
    acceptedOf(result);
  }

  /**
   * Opens the service to the internet on its own address, or closes it. A
   * service without a port is refused with
   * `cloud.errors.settings.public_needs_port`.
   */
  async setServiceExposure(
    serviceId: string,
    isPublic: boolean,
  ): Promise<void> {
    const result = await this.client.PUT(
      "/api/cloud/services/{serviceId}/network",
      { params: { path: { serviceId } }, body: { isPublic }, parseAs: "text" },
    );
    acceptedOf(result);
  }

  /**
   * Names the Dockerfile, inside its repository, that builds the service, or
   * goes back to the root `Dockerfile` or a recipe with `null`. The next
   * build reads it. A path that is not a plain relative path is refused with
   * `cloud.errors.settings.invalid_dockerfile_path`, a service that builds no
   * repository with `cloud.errors.settings.not_a_repository_source`.
   */
  async setServiceDockerfile(
    serviceId: string,
    path: string | null,
  ): Promise<void> {
    const result = await this.client.PUT(
      "/api/cloud/services/{serviceId}/source-dockerfile",
      { params: { path: { serviceId } }, body: { path }, parseAs: "text" },
    );
    acceptedOf(result);
  }

  /**
   * Names the folder of its repository the service builds from, such as
   * `apps/web` in a monorepo, or goes back to the repository root with
   * `null`. The next build takes the folder as its context, and the next
   * push rebuilds the service only when it touches the folder, a shared path
   * or the Dockerfile. A path that is not a plain relative path is refused
   * with `cloud.errors.settings.invalid_root_path`, a service that builds no
   * repository with `cloud.errors.settings.not_a_repository_source`.
   */
  async setServiceRootPath(
    serviceId: string,
    path: string | null,
  ): Promise<void> {
    const result = await this.client.PUT(
      "/api/cloud/services/{serviceId}/source-root-path",
      { params: { path: { serviceId } }, body: { path }, parseAs: "text" },
    );
    acceptedOf(result);
  }

  /**
   * Names the paths outside the root folder a push rebuilds the service for,
   * such as a shared package or the lockfile at the repository root; an
   * empty list clears them. Read by the next push, and only while the
   * service has a root folder. More than 20 paths, or one that is not a
   * plain relative path, is refused with
   * `cloud.errors.settings.invalid_shared_paths`, a service that builds no
   * repository with `cloud.errors.settings.not_a_repository_source`.
   */
  async setServiceSharedPaths(
    serviceId: string,
    paths: readonly string[],
  ): Promise<void> {
    const result = await this.client.PUT(
      "/api/cloud/services/{serviceId}/source-shared-paths",
      {
        params: { path: { serviceId } },
        body: { paths: [...paths] },
        parseAs: "text",
      },
    );
    acceptedOf(result);
  }

  /**
   * Points the service at another source, the whole of it in one write: an
   * upload each deploy carries, or a repository with its branch, Dockerfile,
   * root folder and shared paths. Configuration only: what runs changes at
   * the next deployment. A source that cannot be one is refused with
   * `cloud.errors.settings.invalid_source`, a repository the workspace's
   * GitHub installation does not grant with 403.
   */
  async setServiceSource(
    serviceId: string,
    source: ServiceSource,
  ): Promise<void> {
    const result = await this.client.PUT(
      "/api/cloud/services/{serviceId}/source",
      { params: { path: { serviceId } }, body: source, parseAs: "text" },
    );
    acceptedOf(result);
  }

  /**
   * Adds a variable to the service that follows a value another service of
   * its environment publishes, such as the `MONGO_URL` of a MongoDB resource.
   * The value never reaches the client; the variable is then listed with a
   * `resource` origin.
   *
   * @param serviceId The service that gets the variable
   * @param key The variable's name on that service
   * @param published The publishing service and the key it publishes
   */
  async followPublishedValue(
    serviceId: string,
    key: string,
    published: PublishedValue,
  ): Promise<void> {
    const result = await this.client.POST(
      "/api/cloud/services/{serviceId}/variables/references",
      {
        params: { path: { serviceId } },
        body: { key, ...published },
        parseAs: "text",
      },
    );
    acceptedOf(result);
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
    const { follow, lastEventId } = request;
    const read = logReadOf({ follow, lastEventId });
    return this.stream(
      `/api/cloud/services/${encodeURIComponent(serviceId)}/logs${read.query}`,
      read.headers,
      undefined,
      request.onOpen,
    );
  }

  /**
   * The output of one build, as the `log` events of its stream, then `end`.
   * Without `follow` it is the newest lines, oldest first. A build that is
   * unknown, of another workspace, or whose service was removed answers 404
   * `cloud.errors.builds.not_found`.
   */
  buildLogs(
    buildId: string,
    request: BuildLogRequest,
  ): AsyncGenerator<SseEvent> {
    const read = logReadOf(request);
    return this.stream(
      `/api/cloud/builds/${encodeURIComponent(buildId)}/logs${read.query}`,
      read.headers,
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
    throw refusal(response, errorBodyOf(text), text);
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
