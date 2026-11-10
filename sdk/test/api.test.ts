import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CloudApi,
  CloudApiError,
  createDevice,
  DEFAULT_API_URL,
  exchangeDevice,
  InvalidApiResponseError,
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

function json(status: number, text: string, headers?: HeadersInit): Response {
  const all = new Headers(headers);
  all.set("content-type", "application/json");
  return new Response(text, { status, headers: all });
}

const OTHER_ORIGIN = "http://127.0.0.1:4010";
const GATEWAY = `${OTHER_ORIGIN}/cloud`;

describe("endpoint", () => {
  test("a client without a base URL talks to the production API", async () => {
    const { sent, send } = recorder(() => json(200, JSON.stringify([])));
    await new CloudApi({ token: "t-1", fetch: send }).listProjects();
    assert.equal(
      sent[0]?.url,
      "https://api.antelopejs.cloud/api/cloud/projects/",
    );
    assert.equal(sent[0]?.authorization, "Bearer t-1");
  });

  test("a base URL and its path move typed calls, uploads and streams alike", async () => {
    const receipt = { deploymentId: "d-1", buildId: "b-1", status: "queued" };
    const { sent, send } = recorder(() => json(202, JSON.stringify(receipt)));
    const api = new CloudApi({
      token: "t",
      baseUrl: `${GATEWAY}/`,
      fetch: send,
    });
    await api.deploy("service/api", new Uint8Array([1, 2]));
    await api.listProjects().catch(() => undefined);
    await api.logs("s", { follow: true }).next();
    assert.deepEqual(
      sent.map((request) => request.url),
      [
        `${GATEWAY}/api/cloud/services/service%2Fapi/source-deployments`,
        `${GATEWAY}/api/cloud/projects/`,
        `${GATEWAY}/api/cloud/services/s/logs?follow=true`,
      ],
    );
  });

  test("the device login names the device and follows the base URL", async () => {
    const device = {
      device_code: "dc",
      user_code: "UC",
      verification_uri: "https://console.example/device",
      expires_in: 600,
      interval: 5,
    };
    const { sent, send } = recorder(() => json(200, JSON.stringify(device)));
    await createDevice("Antelope DMS", { baseUrl: OTHER_ORIGIN, fetch: send });
    await exchangeDevice("dc", { fetch: send }).catch(() => undefined);
    assert.equal(sent[0]?.url, `${OTHER_ORIGIN}/api/cloud/cli/device`);
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), {
      device_name: "Antelope DMS",
    });
    assert.equal(sent[1]?.url, `${DEFAULT_API_URL}/api/cloud/cli/token`);
  });
});

describe("refusals", () => {
  test("a refusal carries its code and string params", async () => {
    const body = {
      message: "cloud.errors.node",
      params: { versions: "22, 24", n: 1 },
    };
    const { send } = recorder(() => json(422, JSON.stringify(body)));
    const api = new CloudApi({ token: "t", fetch: send });
    await assert.rejects(api.readProject("p"), (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "cloud.errors.node");
      assert.deepEqual(error.params, { versions: "22, 24" });
      return true;
    });
  });

  test("a rate-limited login says how long to wait", async () => {
    const { send } = recorder(() =>
      json(429, JSON.stringify("too_many_requests"), { "retry-after": "17" }),
    );
    await assert.rejects(createDevice("CLI", { fetch: send }), (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.code, "too_many_requests");
      assert.equal(error.retryAfterS, 17);
      return true;
    });
  });

  test("an upload accepted with something other than a receipt is refused", async () => {
    const { send } = recorder(() =>
      json(202, JSON.stringify({ deploymentId: "d-1" })),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    await assert.rejects(
      api.deploy("s", new Uint8Array([1])),
      InvalidApiResponseError,
    );
  });
});

describe("environment variables", () => {
  const environment = ["p/1", "env 2"] as const;
  const encodedEnvironment = "p%2F1/environments/env%202";
  const variableUrl = (key: string) =>
    `${DEFAULT_API_URL}/api/cloud/projects/${encodedEnvironment}/services/svc%2F3/variables/${key}`;
  const row = {
    serviceId: "svc/3",
    key: "API KEY",
    secret: true,
    value: null,
    origin: { type: "manual" },
  };

  test("a list reads the environment's variables at its encoded path", async () => {
    const list = { variables: [row] };
    const { sent, send } = recorder(() => json(200, JSON.stringify(list)));
    const api = new CloudApi({ token: "t-1", fetch: send });

    assert.deepEqual(await api.listVariables(...environment), list);
    assert.equal(sent[0]?.method, "GET");
    assert.equal(
      sent[0]?.url,
      `${DEFAULT_API_URL}/api/cloud/projects/${encodedEnvironment}/variables`,
    );
    assert.equal(sent[0]?.authorization, "Bearer t-1");
  });

  test("a set puts the body at the encoded variable path and answers the row, which a POST to the list would miss", async () => {
    const { sent, send } = recorder(() => json(200, JSON.stringify(row)));
    const api = new CloudApi({ token: "t", fetch: send });

    const written = await api.setVariable(...environment, "svc/3", "API KEY", {
      value: "s3cret",
      secret: true,
    });

    assert.deepEqual(written, row);
    assert.equal(sent[0]?.method, "PUT");
    assert.equal(sent[0]?.url, variableUrl("API%20KEY"));
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), {
      value: "s3cret",
      secret: true,
    });
  });

  test("a delete accepts an answer with no body, which a client demanding JSON data would refuse", async () => {
    for (const status of [200, 204]) {
      const { sent, send } = recorder(() => new Response(null, { status }));
      const api = new CloudApi({ token: "t", fetch: send });

      assert.equal(
        await api.deleteVariable(...environment, "svc/3", "KEY"),
        undefined,
      );
      assert.equal(sent[0]?.method, "DELETE");
      assert.equal(sent[0]?.url, variableUrl("KEY"));
    }
  });

  test("a refused list, set or delete is a CloudApiError carrying the code", async () => {
    const { send } = recorder(() =>
      json(404, JSON.stringify("cloud.errors.settings.unknown_variable")),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    const calls = [
      () => api.listVariables(...environment),
      () => api.setVariable(...environment, "svc/3", "KEY", { value: "v" }),
      () => api.deleteVariable(...environment, "svc/3", "KEY"),
    ];

    for (const call of calls) {
      await assert.rejects(call(), (error) => {
        assert.ok(error instanceof CloudApiError);
        assert.equal(error.status, 404);
        assert.equal(error.code, "cloud.errors.settings.unknown_variable");
        return true;
      });
    }
  });
});
