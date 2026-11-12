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

describe("a service built from a repository", () => {
  const SERVICES =
    "https://api.antelopejs.cloud/api/cloud/projects/prj%2F1/environments/env%2F2/services";

  test("is created with its repository and the Dockerfile that builds it, and answers its id", async () => {
    const created = {
      serviceId: "svc-9",
      name: "dashboard",
      appName: "shop-dashboard",
    };
    const { sent, send } = recorder(
      () =>
        new Response(JSON.stringify(created), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const api = new CloudApi({ token: "t-1", fetch: send });

    const answer = await api.createService("prj/1", "env/2", {
      name: "dashboard",
      appName: "shop-dashboard",
      source: {
        type: "repository",
        repository: "acme/shop",
        dockerfilePath: "frontend.Dockerfile",
      },
      port: 3000,
      isPublic: true,
    });

    assert.deepEqual(answer, created);
    assert.equal(sent[0]?.method, "POST");
    assert.equal(sent[0]?.url, SERVICES);
    assert.equal(sent[0]?.authorization, "Bearer t-1");
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), {
      name: "dashboard",
      appName: "shop-dashboard",
      source: {
        type: "repository",
        repository: "acme/shop",
        dockerfilePath: "frontend.Dockerfile",
      },
      port: 3000,
      isPublic: true,
    });
  });

  test("an upload service is still created as before", async () => {
    const { sent, send } = recorder(
      () =>
        new Response(
          JSON.stringify({ serviceId: "svc-1", name: "web", appName: "web" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const api = new CloudApi({ token: "t", fetch: send });

    await api.createService("prj/1", "env/2", {
      name: "web",
      appName: "web",
      source: { type: "upload" },
    });

    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), {
      name: "web",
      appName: "web",
      source: { type: "upload" },
    });
  });

  test("its Dockerfile is put at the encoded service path, null goes back to the default, and an answer with no body is accepted", async () => {
    for (const status of [200, 204]) {
      const { sent, send } = recorder(() => new Response(null, { status }));
      const api = new CloudApi({ token: "t", fetch: send });

      assert.equal(
        await api.setServiceDockerfile("svc/3", "apps/web/Dockerfile"),
        undefined,
      );
      await api.setServiceDockerfile("svc/3", null);

      assert.deepEqual(
        sent.map(
          (request) => `${request.method} ${request.url} ${request.body}`,
        ),
        [
          `PUT ${SERVICE}/source-dockerfile {"path":"apps/web/Dockerfile"}`,
          `PUT ${SERVICE}/source-dockerfile {"path":null}`,
        ],
      );
    }
  });

  test("a refused Dockerfile is a CloudApiError carrying the code", async () => {
    const refusals: Array<[number, string]> = [
      [400, "cloud.errors.settings.invalid_dockerfile_path"],
      [409, "cloud.errors.settings.not_a_repository_source"],
    ];

    for (const [status, code] of refusals) {
      const { send } = recorder(
        () =>
          new Response(JSON.stringify(code), {
            status,
            headers: { "content-type": "application/json" },
          }),
      );
      const api = new CloudApi({ token: "t", fetch: send });

      await assert.rejects(
        api.setServiceDockerfile("svc/3", "../Dockerfile"),
        (error) => {
          assert.ok(error instanceof CloudApiError);
          assert.equal(error.status, status);
          assert.equal(error.code, code);
          return true;
        },
      );
    }
  });
});

describe("a variable that follows a published value", () => {
  const database = { serviceId: "svc-db", publishedKey: "MONGO_URL" };

  test("names the variable, the publisher and its key in one POST, and accepts an answer with no body", async () => {
    const { sent, send } = recorder(() => new Response(null, { status: 200 }));
    const api = new CloudApi({ token: "t", fetch: send });

    assert.equal(
      await api.followPublishedValue("svc/3", "MONGODB_URL", database),
      undefined,
    );

    assert.equal(sent[0]?.method, "POST");
    assert.equal(sent[0]?.url, `${SERVICE}/variables/references`);
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), {
      key: "MONGODB_URL",
      serviceId: "svc-db",
      publishedKey: "MONGO_URL",
    });
  });

  test("a name the service already holds is a CloudApiError carrying the code", async () => {
    const { send } = recorder(
      () =>
        new Response(JSON.stringify("cloud.errors.settings.duplicate_key"), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
    );
    const api = new CloudApi({ token: "t", fetch: send });

    await assert.rejects(
      api.followPublishedValue("svc/3", "MONGODB_URL", database),
      (error) => {
        assert.ok(error instanceof CloudApiError);
        assert.equal(error.code, "cloud.errors.settings.duplicate_key");
        return true;
      },
    );
  });
});
