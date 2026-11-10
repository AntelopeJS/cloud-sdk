import type { Client } from "openapi-fetch";
import type { components, operations, paths } from "./generated/cloud-api.js";
import { dataOf } from "./result.js";

export type DeploymentHistory = components["schemas"]["DeploymentHistory"];
export type RevisionSummary = components["schemas"]["RevisionSummary"];
export type RevisionBuild = components["schemas"]["RevisionBuild"];
export type ActiveBuild = components["schemas"]["ActiveBuild"];
export type DeploymentStatus = components["schemas"]["DeploymentStatus"];
export type ProjectDeployment = components["schemas"]["ProjectDeployment"];
export type ProjectDeploymentPage =
  components["schemas"]["ProjectDeploymentPage"];
/** Which deployments a page holds, and where it starts. */
export type ProjectDeploymentQuery = NonNullable<
  operations["listProjectDeployments"]["parameters"]["query"]
>;

/** Every deployment of a project, across its environments. */
export class ProjectDeploymentsApi {
  constructor(private readonly client: Client<paths>) {}

  /**
   * One page of the project's deployments, newest first. Pass the page's
   * `nextCursor` as `cursor` to read the next, older one.
   */
  async list(
    projectId: string,
    query: ProjectDeploymentQuery = {},
  ): Promise<ProjectDeploymentPage> {
    const result = await this.client.GET(
      "/api/cloud/projects/{projectId}/deployments",
      { params: { path: { projectId }, query } },
    );
    return dataOf(result);
  }
}
