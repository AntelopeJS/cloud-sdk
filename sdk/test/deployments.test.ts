import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { CloudApi, type DeploymentHistory } from "../src/index.js";

const ROOT_SPEC_CEILING_BYTES = 20_000;

function answering(text: string) {
  const urls: string[] = [];
  const send: typeof fetch = async (input, init) => {
    urls.push(new Request(input, init).url);
    return new Response(text, {
      status: 200,
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
