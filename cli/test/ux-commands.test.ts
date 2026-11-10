import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { jsonAt, parseJson } from "./json.js";
import {
  CONSOLE,
  HISTORY_PATH,
  PROVISIONING_PATH,
  fixture,
  frame,
  origin,
  reply,
  requests,
  rollingOutRevision,
  routes,
  run,
  runBinary,
  serveMockApi,
  sse,
} from "./ux-fixture.js";

serveMockApi();

describe("C6: command-line mistakes", () => {
  test("an unknown command is reported once", async () => {
    const result = await runBinary(["deplyo"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^\S+ Unknown command 'deplyo'\n/);
    assert.match(result.stderr, /Did you mean deploy\?/);
    assert.equal(result.stderr.match(/deplyo/g)?.length, 1);
  });

  test("a missing argument is reported once, as one JSON error in CI", async () => {
    const human = await runBinary(["link"]);
    assert.equal(human.status, 2);
    assert.equal(human.stderr.match(/Missing required argument/g)?.length, 1);
    const json = await runBinary(["--json", "link"]);
    assert.equal(json.stderr.trim().split("\n").length, 1);
    assert.equal(
      JSON.parse(json.stderr).error.code,
      "commander.missingArgument",
    );
    assert.equal(json.status, 2);
  });
});

describe("C7: help, version and session commands", () => {
  test("every command has a description", async () => {
    const result = await runBinary(["--help"]);
    const commands =
      result.stdout.split("Commands:\n")[1]?.split("\n\n")[0] ?? "";
    const rows = commands.split("\n").filter((row) => /^ {2}\S/.test(row));
    assert.ok(rows.length >= 9);
    for (const row of rows) assert.match(row, /\S\s{2,}\S/, row);
    assert.match(result.stdout, /Examples:/);
  });

  test("--version prints the package version", async () => {
    const result = await runBinary(["--version"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/);
  });

  test("whoami shows the session and checks it is still accepted", async () => {
    const current = await fixture();
    await run(current.runtime, ["whoami"]);
    assert.deepEqual(current.streams.stdout, [
      "Workspace  workspace-1 (ready)",
      `API        ${origin}`,
      `Console    ${CONSOLE}`,
    ]);
    routes[PROVISIONING_PATH] = reply(401, "Unauthorized");
    const result = await runBinary(["whoami"], current);
    assert.match(
      result.stderr,
      /session has expired or was revoked\n(.*\n)*.*Run ajs-cloud login again/,
    );
  });

  test("logout forgets the session", async () => {
    const current = await fixture();
    await run(current.runtime, ["logout"]);
    await assert.rejects(
      access(join(current.runtime.configHome, "antelopejs", "cloud.json")),
    );
    await run(current.runtime, ["logout"]);
    assert.deepEqual(current.output, [
      "✔ Logged out: the saved session was removed from this machine",
      "– You were not logged in",
    ]);
  });

  test("logs reads once without -f, and follows with it", async () => {
    const current = await fixture();
    const log = `id: c1\n${frame("log", { at: "2026-09-29T10:00:00Z", level: "info", message: "ready", instance: null })}`;
    routes["/api/cloud/services/service-web/logs"] = sse(
      `${log}${frame("end", {})}`,
    );
    routes["/api/cloud/services/service-web/logs?follow=true"] = sse(
      `${log}${frame("end", {})}`,
    );
    await run(current.runtime, ["logs", "web"]);
    await run(current.runtime, ["logs", "web", "-f"]);
    assert.deepEqual(
      requests.filter((request) => request.includes("/logs")),
      [
        "GET /api/cloud/services/service-web/logs",
        "GET /api/cloud/services/service-web/logs?follow=true",
      ],
    );
    assert.deepEqual(current.output, [
      "2026-09-29T10:00:00Z info ready",
      "2026-09-29T10:00:00Z info ready",
    ]);
  });

  test("logs of a service never deployed says so", async () => {
    const current = await fixture();
    routes["/api/cloud/services/service-web/logs"] = sse(
      frame("not_deployed", {}),
    );
    await run(current.runtime, ["logs", "web"]);
    assert.match(current.streams.stderr[0] ?? "", /no deployment yet/);
  });
});

describe("C8: status of a deployment on its way", () => {
  test("reports a queued first deployment instead of not deployed", async () => {
    const current = await fixture();
    routes[HISTORY_PATH] = reply(200, {
      revisions: [],
      desiredRevisionId: null,
      activeBuilds: [
        {
          id: "build-1",
          deploymentId: "deployment-1",
          status: "queued",
          queuePosition: 2,
          createdAt: "2026-09-29T10:00:00Z",
        },
      ],
    });
    await run(current.runtime, ["status"]);
    assert.deepEqual(current.output, [
      "web\tdeploying (queued, position in queue: 2)\thttps://web.example.test",
    ]);
    await run(current.runtime, ["--json", "status"]);
    const service = jsonAt(
      parseJson(current.output.at(-1) ?? ""),
      "data",
      "services",
      0,
    );
    assert.equal(jsonAt(service, "status"), "deploying");
    assert.deepEqual(jsonAt(service, "deployment"), {
      deploymentId: "deployment-1",
      status: "queued",
      queuePosition: 2,
    });
  });

  test("N6: reports a first deployment stuck rolling out instead of not deployed", async () => {
    const current = await fixture();
    routes[HISTORY_PATH] = reply(200, {
      activeBuilds: [],
      revisions: [rollingOutRevision("pending")],
      desiredRevisionId: "revision-1",
    });
    routes["/api/cloud/deployments/deployment-1"] = reply(200, {
      id: "deployment-1",
      status: "checking",
      failure: null,
    });
    await run(current.runtime, ["status"]);
    assert.deepEqual(current.output, [
      "web\tdeploying (rolling out)\thttps://web.example.test",
    ]);
    await run(current.runtime, ["--json", "status"]);
    const service = jsonAt(
      parseJson(current.output.at(-1) ?? ""),
      "data",
      "services",
      0,
    );
    assert.equal(jsonAt(service, "status"), "deploying");
    assert.deepEqual(jsonAt(service, "deployment"), {
      deploymentId: "deployment-1",
      status: "checking",
      queuePosition: null,
    });
  });

  test("N6: a rollout whose deployment cannot be read still reads as rolling out", async () => {
    const current = await fixture();
    routes[HISTORY_PATH] = reply(200, {
      revisions: [rollingOutRevision("preparing")],
      desiredRevisionId: "revision-1",
    });
    await run(current.runtime, ["status"]);
    assert.deepEqual(current.output, [
      "web\tdeploying (rolling out)\thttps://web.example.test",
    ]);
  });

  test("N6: a failed newest revision is not in flight", async () => {
    const current = await fixture();
    routes[HISTORY_PATH] = reply(200, {
      revisions: [rollingOutRevision("failed")],
      desiredRevisionId: null,
    });
    await run(current.runtime, ["status"]);
    assert.deepEqual(current.output, [
      "web\tnot deployed\thttps://web.example.test",
    ]);
  });

  test("N6: a revision whose deployment already ended is not in flight", async () => {
    const current = await fixture();
    routes[HISTORY_PATH] = reply(200, {
      revisions: [rollingOutRevision("pending")],
      desiredRevisionId: "revision-1",
    });
    routes["/api/cloud/deployments/deployment-1"] = reply(200, {
      id: "deployment-1",
      status: "cancelled",
      failure: null,
    });
    await run(current.runtime, ["status"]);
    assert.deepEqual(current.output, [
      "web\tnot deployed\thttps://web.example.test",
    ]);
  });
});
