import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CloudApi, CloudApiError } from "../src/index.js";

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

const SERVICE = "https://api.antelopejs.cloud/api/cloud/services/svc%2F3";

describe("service network settings", () => {
  test("a port is put at the encoded service path, null clears it, and an answer with no body is accepted", async () => {
    for (const status of [200, 204]) {
      const { sent, send } = recorder(() => new Response(null, { status }));
      const api = new CloudApi({ token: "t-1", fetch: send });

      assert.equal(await api.setServicePort("svc/3", 5010), undefined);
      await api.setServicePort("svc/3", null);

      assert.deepEqual(
        sent.map(
          (request) => `${request.method} ${request.url} ${request.body}`,
        ),
        [
          `PUT ${SERVICE}/port {"port":5010}`,
          `PUT ${SERVICE}/port {"port":null}`,
        ],
      );
      assert.equal(sent[0]?.authorization, "Bearer t-1");
    }
  });

  test("an exposure is put at the service's network path, open or closed", async () => {
    const { sent, send } = recorder(() => new Response(null, { status: 200 }));
    const api = new CloudApi({ token: "t", fetch: send });

    assert.equal(await api.setServiceExposure("svc/3", true), undefined);
    await api.setServiceExposure("svc/3", false);

    assert.deepEqual(
      sent.map((request) => `${request.method} ${request.url} ${request.body}`),
      [
        `PUT ${SERVICE}/network {"isPublic":true}`,
        `PUT ${SERVICE}/network {"isPublic":false}`,
      ],
    );
  });

  test("a refused port or exposure is a CloudApiError carrying the code", async () => {
    const { send } = recorder(
      () =>
        new Response(
          JSON.stringify("cloud.errors.settings.public_needs_port"),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    const calls = [
      () => api.setServicePort("svc/3", null),
      () => api.setServiceExposure("svc/3", true),
    ];

    for (const call of calls) {
      await assert.rejects(call(), (error) => {
        assert.ok(error instanceof CloudApiError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "cloud.errors.settings.public_needs_port");
        return true;
      });
    }
  });
});
