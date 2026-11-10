import type { Client } from "openapi-fetch";
import type { components, paths } from "./generated/cloud-api.js";
import { acceptedOf, dataOf } from "./result.js";

export type EnvironmentDetail = components["schemas"]["EnvironmentDetail"];
export type EnvironmentDeployment =
  components["schemas"]["EnvironmentDeployment"];
export type EnvironmentHealth = components["schemas"]["EnvironmentHealth"];
export type NewEnvironment = components["schemas"]["NewEnvironment"];
export type Promotion = components["schemas"]["Promotion"];
export type PromotionReceipt = components["schemas"]["PromotionReceipt"];
export type ServiceHealth = components["schemas"]["ServiceHealth"];

type CloudClient = Client<paths>;

const ENVIRONMENTS = "/api/cloud/projects/{projectId}/environments";
const ENVIRONMENT =
  "/api/cloud/projects/{projectId}/environments/{environmentId}";

/**
 * A project's environments. Each one is a git branch Cloud builds and serves,
 * with its own services, database and secrets.
 */
export class EnvironmentsApi {
  constructor(private readonly client: CloudClient) {}

  /** Every environment of the project, durable ones first, previews after. */
  async list(projectId: string): Promise<EnvironmentDetail[]> {
    const result = await this.client.GET(ENVIRONMENTS, {
      params: { path: { projectId } },
    });
    return dataOf(result).environments;
  }

  async read(
    projectId: string,
    environmentId: string,
  ): Promise<EnvironmentDetail> {
    const result = await this.client.GET(ENVIRONMENT, {
      params: { path: { projectId, environmentId } },
    });
    return dataOf(result);
  }

  async create(projectId: string, body: NewEnvironment) {
    const result = await this.client.POST(ENVIRONMENTS, {
      params: { path: { projectId } },
      body,
    });
    return dataOf(result);
  }

  /** Deletes the environment, its services and its previews. A protected one refuses. */
  async delete(projectId: string, environmentId: string): Promise<void> {
    const result = await this.client.POST(`${ENVIRONMENT}/deletion`, {
      params: { path: { projectId, environmentId } },
      parseAs: "text",
    });
    acceptedOf(result);
  }

  /**
   * Builds and deploys a commit of the project's repository, or a branch tip,
   * to the environment. The serving version keeps the traffic until the new
   * one passes its health check.
   */
  async promote(
    projectId: string,
    environmentId: string,
    promotion: Promotion,
  ): Promise<PromotionReceipt> {
    const result = await this.client.POST(`${ENVIRONMENT}/promotion`, {
      params: { path: { projectId, environmentId } },
      body: promotion,
    });
    return dataOf(result);
  }

  /** The health check settings of each service and the latest results. */
  async health(
    projectId: string,
    environmentId: string,
  ): Promise<EnvironmentHealth> {
    const result = await this.client.GET(`${ENVIRONMENT}/health`, {
      params: { path: { projectId, environmentId } },
    });
    return dataOf(result);
  }
}

/** The GitHub repository a project builds from, as `owner/name`. */
export class ProjectRepositoryApi {
  constructor(private readonly client: CloudClient) {}

  async read(projectId: string): Promise<string | null> {
    const result = await this.client.GET(
      "/api/cloud/projects/{projectId}/repository",
      { params: { path: { projectId } } },
    );
    return dataOf(result).repository;
  }

  /**
   * Links the project to a repository a GitHub installation of the workspace
   * grants; null unlinks it, and the answer falls back to the repository most
   * of its services build from.
   */
  async link(
    projectId: string,
    repository: string | null,
  ): Promise<string | null> {
    const result = await this.client.PUT(
      "/api/cloud/projects/{projectId}/repository",
      { params: { path: { projectId } }, body: { repository } },
    );
    return dataOf(result).repository;
  }
}
