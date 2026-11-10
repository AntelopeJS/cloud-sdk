import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CloudApiError } from "@antelopejs/cloud-sdk";
import { readCredentials } from "../src/config.js";
import { consoleUrl } from "../src/console-urls.js";
import { describeApiError } from "../src/error-messages.js";
import { CliError } from "../src/errors.js";
import { isRecord } from "../src/guards.js";
import { WORKSPACE_WAIT_MS } from "../src/workspace.js";
import { jsonAt, parseJsonLines } from "./json.js";
import {
  CONSOLE,
  DEVICE_AUTHORIZATION,
  PROJECT_PATH,
  PROVISIONING_PATH,
  fixture,
  json,
  origin,
  project,
  provisioning,
  reply,
  requests,
  routes,
  run,
  runBinary,
  serveMockApi,
  told,
  types,
} from "./ux-fixture.js";

serveMockApi();

describe("C1: console URLs", () => {
  test("open prints the console project page, not a 404 path", async () => {
    const current = await fixture();
    await run(current.runtime, ["--yes", "open"]);
    assert.deepEqual(current.streams.stdout, [
      `${CONSOLE}/projects/project?project=project-1`,
    ]);
  });

  test("a service without a public URL opens its console page", async () => {
    const current = await fixture();
    routes[PROJECT_PATH] = reply(200, project(null));
    await run(current.runtime, ["--yes", "open", "web"]);
    assert.deepEqual(current.streams.stdout, [
      `${CONSOLE}/projects/project/service?project=project-1&service=service-web`,
    ]);
  });

  test("builds every console page from ids as query parameters", () => {
    assert.equal(
      consoleUrl(CONSOLE, "deployment", {
        project: "p",
        service: "s",
        deployment: "d",
      }),
      `${CONSOLE}/projects/project/deployment?project=p&service=s&deployment=d`,
    );
  });
});

describe("C2: signed out", () => {
  for (const [label, isLinked, args] of [
    ["deploy in a new folder", false, ["deploy"]],
    ["deploy in a linked folder", true, ["deploy"]],
    ["status in a folder never linked", false, ["status"]],
    ["logs", true, ["logs", "web"]],
  ] as const) {
    test(`${label} says to log in, before any request`, async () => {
      const current = await fixture({ isLinked, isLoggedIn: false });
      const result = await runBinary([...args], current);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /^\S+ You are not logged in\n {2}\S+ Run ajs-cloud login, then run the command again\n$/,
      );
      assert.equal(result.stdout, "");
      assert.deepEqual(requests, []);
    });
  }

  test("status in an unlinked folder explains the next command", async () => {
    const current = await fixture({ isLinked: false });
    const result = await runBinary(["status"], current);
    assert.match(
      result.stderr,
      /not linked to a project\n.*Run ajs-cloud deploy to create one/,
    );
    const json = await runBinary(["--json", "status"], current);
    assert.equal(JSON.parse(json.stderr).error.code, "project_not_linked");
  });
});

describe("C3: login polling", () => {
  test("keeps polling through network failures and server errors", async () => {
    const current = await fixture({ isLinked: false, isLoggedIn: false });
    let polls = 0;
    routes["/api/cloud/cli/device"] = reply(200, DEVICE_AUTHORIZATION);
    routes["/api/cloud/cli/token"] = (request, response) => {
      polls += 1;
      if (polls === 1) return void request.socket.destroy();
      if (polls === 2) return json(response, 502, { error: "bad_gateway" });
      if (polls === 3)
        return json(response, 400, { error: "authorization_pending" });
      json(response, 200, {
        access_token: "secret-token",
        token_type: "Bearer",
        workspace_id: "workspace-1",
      });
    };
    await run(current.runtime, ["--yes", "--api-url", origin, "login"]);
    assert.equal(polls, 4);
    assert.equal(
      (await readCredentials(current.runtime.configHome)).workspace,
      "workspace-1",
    );
    assert.ok(current.output.includes("✔ Logged in · workspace-1"));
    assert.ok(current.output.some((line) => line.includes("ajs-cloud deploy")));
  });

  test("N5: names the workspace the session was approved for", async () => {
    const current = await fixture({ isLinked: false, isLoggedIn: false });
    routes["/api/cloud/cli/device"] = reply(200, DEVICE_AUTHORIZATION);
    routes["/api/cloud/cli/token"] = reply(200, {
      access_token: "secret-token",
      token_type: "Bearer",
      workspace_id: "workspace-1",
      workspace_name: "E2E Source 1001",
    });
    await run(current.runtime, ["--yes", "--api-url", origin, "login"]);
    assert.ok(
      current.output.includes("✔ Logged in · E2E Source 1001 (workspace-1)"),
    );
    await run(current.runtime, [
      "--json",
      "--yes",
      "--api-url",
      origin,
      "login",
    ]);
    const succeeded = parseJsonLines(current.output).find(
      (line) => isRecord(line) && line.type === "login_succeeded",
    );
    assert.ok(succeeded !== undefined);
    assert.deepEqual(jsonAt(succeeded, "data"), {
      workspace: "workspace-1",
      workspaceName: "E2E Source 1001",
    });
  });

  test("waits out a busy network's rate limit on the login code", async () => {
    const current = await fixture({ isLinked: false, isLoggedIn: false });
    let creates = 0;
    routes["/api/cloud/cli/device"] = (_request, response) => {
      creates += 1;
      if (creates <= 2) {
        response.writeHead(429, {
          "content-type": "application/json",
          "retry-after": "17",
        });
        return void response.end(
          JSON.stringify({ error: "rate_limit_exceeded" }),
        );
      }
      json(response, 200, DEVICE_AUTHORIZATION);
    };
    routes["/api/cloud/cli/token"] = reply(200, {
      access_token: "secret-token",
      token_type: "Bearer",
      workspace_id: "workspace-1",
    });
    const before = current.clock.now;
    await run(current.runtime, ["--yes", "--api-url", origin, "login"]);
    assert.equal(creates, 3);
    assert.ok(current.clock.now - before >= 2 * 17_000);
    assert.ok(
      current.output.some((line) =>
        line.includes(
          "Too many login requests from your network: trying again in 17 s",
        ),
      ),
    );
    assert.equal(
      (await readCredentials(current.runtime.configHome)).workspace,
      "workspace-1",
    );
  });

  test("gives up on the login code after the bounded retries", async () => {
    const current = await fixture({ isLinked: false, isLoggedIn: false });
    let creates = 0;
    routes["/api/cloud/cli/device"] = (_request, response) => {
      creates += 1;
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "3600",
      });
      response.end(JSON.stringify({ error: "rate_limit_exceeded" }));
    };
    const before = current.clock.now;
    await assert.rejects(
      run(current.runtime, ["--yes", "--api-url", origin, "login"]),
      { code: "rate_limit_exceeded" },
    );
    assert.equal(creates, 6);
    assert.equal(current.clock.now - before, 5 * 60_000);
  });

  test("still stops on a refusal that is an answer", async () => {
    const current = await fixture({ isLinked: false, isLoggedIn: false });
    routes["/api/cloud/cli/device"] = reply(200, DEVICE_AUTHORIZATION);
    routes["/api/cloud/cli/token"] = reply(400, { error: "access_denied" });
    await assert.rejects(
      run(current.runtime, ["--yes", "--api-url", origin, "login"]),
      { code: "access_denied" },
    );
  });
});

describe("C4: workspace not ready", () => {
  test("waits for a workspace being prepared before creating anything", async () => {
    const current = await fixture({ isLinked: false });
    const phases = ["pending", "reconciling", "ready"];
    routes[PROVISIONING_PATH] = (_, response) =>
      json(response, 200, provisioning(phases.shift() ?? "ready", "preparing"));
    routes["GET /api/cloud/projects/"] = reply(200, { projects: [] });
    routes["/api/cloud/onboarding/"] = reply(200, {
      canCreateProjects: false,
      regions: ["eu-central"],
      defaultRegion: "eu-central",
    });
    await assert.rejects(run(current.runtime, ["--json", "--yes", "deploy"]), {
      code: "project_creation_forbidden",
    });
    const seen = types(current.output);
    assert.deepEqual(seen.slice(0, 3), [
      "project_not_linked",
      "workspace_not_ready",
      "workspace_ready",
    ]);
    const firstProjectRead = requests.indexOf("GET /api/cloud/projects/");
    assert.equal(
      requests
        .slice(0, firstProjectRead)
        .filter((r) => r === `GET ${PROVISIONING_PATH}`).length,
      3,
    );
  });

  test("explains a blocked workspace and creates nothing", async () => {
    const current = await fixture({ isLinked: false });
    routes[PROVISIONING_PATH] = reply(
      200,
      provisioning("blocked", "permission_denied"),
    );
    await assert.rejects(run(current.runtime, ["--yes", "deploy"]), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "workspace_blocked");
      assert.match(told(error), /needs attention: permission_denied/);
      return true;
    });
    assert.ok(requests.every((request) => request.startsWith("GET ")));
  });

  test("gives up after a bounded wait with the next step", async () => {
    const current = await fixture();
    routes[PROVISIONING_PATH] = reply(
      200,
      provisioning("pending", "delivery_pending"),
    );
    const startedAt = current.clock.now;
    await assert.rejects(run(current.runtime, ["deploy"]), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "workspace_not_ready");
      assert.match(told(error), /Run ajs-cloud deploy again/);
      return true;
    });
    assert.ok(current.clock.now - startedAt >= WORKSPACE_WAIT_MS);
    assert.ok(!requests.some((request) => request.startsWith("POST ")));
  });

  test("maps the API's not-ready refusal to a sentence", () => {
    const error = new CloudApiError(409, "cloud.errors.workspace.not_ready");
    assert.match(describeApiError(error, "en").title, /being prepared/);
    assert.match(describeApiError(error, "fr").title, /en préparation/);
  });
});
