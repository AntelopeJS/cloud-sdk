import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
  CloudApi,
  CloudApiError,
  type DeploymentHistory,
  type ProjectDeploymentPage,
} from "../src/index.js";

const ROOT_SPEC_CEILING_BYTES = 20_000;

function answering(text: string, status = 200) {
  const urls: string[] = [];
  const send: typeof fetch = async (input, init) => {
    urls.push(new Request(input, init).url);
    return new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { urls, send };
}

const history: DeploymentHistory = {
  desiredRevisionId: "rev-2",
  revisions: [
    {
      id: "rev-2",
      number: 2,
      isDesired: true,
      canRollback: false,
      createdAt: "2026-11-10T09:30:00.000Z",
      origin: "build",
      build: {
        branch: "main",
        commit: "e7b1d09",
        commitMessage: "fix: keep the cart",
        durationSeconds: 84,
      },
    },
    {
      id: "rev-1",
      number: 1,
      isDesired: false,
      canRollback: true,
      createdAt: "2026-11-09T18:02:00.000Z",
      origin: "image",
      build: null,
    },
  ],
};

describe("service deployment history", () => {
  test("each revision says when it was made and what it was built from", async () => {
    const { urls, send } = answering(JSON.stringify(history));
    const api = new CloudApi({ token: "t", fetch: send });
    const answer = await api.deploymentHistory("svc/1");
    assert.equal(
      urls[0],
      "https://api.antelopejs.cloud/api/cloud/services/svc%2F1/deployments",
    );
    const [built, pulled] = answer.revisions;
    assert.equal(built?.createdAt, "2026-11-10T09:30:00.000Z");
    assert.equal(built?.origin, "build");
    assert.equal(built?.build?.commit, "e7b1d09");
    assert.equal(built?.build?.durationSeconds, 84);
    assert.equal(pulled?.origin, "image");
    assert.equal(pulled?.build, null);
  });
});

const PROJECTS = "https://api.antelopejs.cloud/api/cloud/projects";

const page: ProjectDeploymentPage = {
  deployments: [
    {
      id: "dep-12",
      number: 12,
      environmentId: "env-1",
      status: "building",
      commit: "e7b1d09",
      branch: "main",
      createdAt: "2026-11-10T09:30:00.000Z",
      finishedAt: null,
      trigger: "push",
      revisionIds: [],
    },
    {
      id: "dep-11",
      number: 11,
      environmentId: "env-1",
      status: "succeeded",
      commit: null,
      branch: null,
      createdAt: "2026-11-09T18:02:00.000Z",
      finishedAt: "2026-11-09T18:04:10.000Z",
      trigger: "upload",
      revisionIds: ["rev-2", "rev-3"],
    },
  ],
  nextCursor: "c-11",
};

describe("project deployments", () => {
  test("a list reads the project's newest deployments and the cursor to the next page", async () => {
    const { urls, send } = answering(JSON.stringify(page));
    const api = new CloudApi({ token: "t", fetch: send });
    const answer = await api.projectDeployments.list("p/1");
    assert.equal(urls[0], `${PROJECTS}/p%2F1/deployments`);
    assert.deepEqual(answer, page);
  });

  test("filters and the page cursor travel as query parameters", async () => {
    const { urls, send } = answering(
      JSON.stringify({ deployments: [], nextCursor: null }),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    await api.projectDeployments.list("p", {
      environmentId: "env-1",
      status: ["queued", "building"],
      cursor: "c-11",
      limit: 50,
    });
    const url = new URL(urls[0] ?? "");
    assert.equal(url.pathname, "/api/cloud/projects/p/deployments");
    assert.equal(url.searchParams.get("environmentId"), "env-1");
    assert.deepEqual(url.searchParams.getAll("status"), ["queued", "building"]);
    assert.equal(url.searchParams.get("cursor"), "c-11");
    assert.equal(url.searchParams.get("limit"), "50");
  });

  test("a refused list is a CloudApiError carrying the code", async () => {
    const { send } = answering(
      JSON.stringify({ code: "project_not_found" }),
      404,
    );
    const api = new CloudApi({ token: "t", fetch: send });
    await assert.rejects(api.projectDeployments.list("p"), (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "project_not_found");
      return true;
    });
  });
});

describe("cloud.openapi.yaml", () => {
  test("stays under its byte ceiling; new parts go in their own file", async () => {
    const spec = await readFile(
      new URL("../../openapi/cloud.openapi.yaml", import.meta.url),
    );
    assert.ok(
      spec.byteLength < ROOT_SPEC_CEILING_BYTES,
      `cloud.openapi.yaml is ${spec.byteLength} bytes`,
    );
  });
});
