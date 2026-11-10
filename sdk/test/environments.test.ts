import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CloudApi,
  CloudApiError,
  type EnvironmentDetail,
} from "../src/index.js";

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  body: string;
}

/** A `fetch` that records each request and answers every one with `answer`. */
function recorder(answer: () => Response) {
  const sent: Sent[] = [];
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    });
    return answer();
  };
  return { sent, send };
}

function json(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PROJECTS = "https://api.antelopejs.cloud/api/cloud/projects";

const staging: EnvironmentDetail = {
  id: "env-2",
  name: "staging",
  branch: "env/staging",
  state: "live",
  url: "https://shop-staging.example.test",
  isProtected: false,
  preview: null,
  serving: null,
  target: null,
  services: [],
};

describe("environments", () => {
  test("list answers the environments, signed with the token", async () => {
    const { sent, send } = recorder(() =>
      json(200, JSON.stringify({ environments: [staging] })),
    );
    const api = new CloudApi({ token: "aclt.t", fetch: send });
    const environments = await api.environments.list("p/1");
    assert.deepEqual(environments, [staging]);
    assert.equal(sent[0]?.url, `${PROJECTS}/p%2F1/environments`);
    assert.equal(sent[0]?.method, "GET");
    assert.equal(sent[0]?.authorization, "Bearer aclt.t");
  });

  test("read, create and health address the environment", async () => {
    const { sent, send } = recorder(() => json(200, JSON.stringify(staging)));
    const api = new CloudApi({ token: "t", fetch: send });
    await api.environments.read("p", "env-2");
    await api.environments.create("p", {
      name: "staging",
      branch: "env/staging",
    });
    await api.environments.health("p", "env-2");
    assert.deepEqual(
      sent.map((request) => `${request.method} ${request.url}`),
      [
        `GET ${PROJECTS}/p/environments/env-2`,
        `POST ${PROJECTS}/p/environments`,
        `GET ${PROJECTS}/p/environments/env-2/health`,
      ],
    );
    assert.deepEqual(JSON.parse(sent[1]?.body ?? ""), {
      name: "staging",
      branch: "env/staging",
    });
  });

  test("delete settles on an empty answer", async () => {
    const { sent, send } = recorder(() => new Response(null, { status: 200 }));
    const api = new CloudApi({ token: "t", fetch: send });
    assert.equal(await api.environments.delete("p", "env-2"), undefined);
    assert.equal(sent[0]?.method, "POST");
    assert.equal(sent[0]?.url, `${PROJECTS}/p/environments/env-2/deletion`);
  });

  test("a refused delete carries its code", async () => {
    const { send } = recorder(() =>
      json(409, JSON.stringify("cloud.errors.environment.protected")),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    await assert.rejects(api.environments.delete("p", "env-1"), (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "cloud.errors.environment.protected");
      return true;
    });
  });

  test("promote sends the commit or the branch and answers the receipt", async () => {
    const commit = "a".repeat(40);
    const { sent, send } = recorder(() =>
      json(200, JSON.stringify({ deploymentId: "d-1", commit })),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    const receipt = await api.environments.promote("p", "env-3", { commit });
    await api.environments.promote("p", "env-3", { branch: "env/staging" });
    assert.deepEqual(receipt, { deploymentId: "d-1", commit });
    assert.equal(sent[0]?.url, `${PROJECTS}/p/environments/env-3/promotion`);
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), { commit });
    assert.deepEqual(JSON.parse(sent[1]?.body ?? ""), {
      branch: "env/staging",
    });
  });
});

describe("project repository", () => {
  test("read and link answer the repository; null unlinks", async () => {
    const { sent, send } = recorder(() =>
      json(200, JSON.stringify({ repository: "acme/shop" })),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    assert.equal(await api.projectRepository.read("p"), "acme/shop");
    assert.equal(
      await api.projectRepository.link("p", "Acme/Shop"),
      "acme/shop",
    );
    await api.projectRepository.link("p", null);
    assert.deepEqual(
      sent.map((request) => `${request.method} ${request.url} ${request.body}`),
      [
        `GET ${PROJECTS}/p/repository `,
        `PUT ${PROJECTS}/p/repository {"repository":"Acme/Shop"}`,
        `PUT ${PROJECTS}/p/repository {"repository":null}`,
      ],
    );
  });
});
