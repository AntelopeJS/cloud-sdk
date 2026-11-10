import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createSourceArchive } from "../src/archive.js";
import { readCredentials, readProjectConfig } from "../src/config.js";
import { describeFailure } from "../src/error-messages.js";
import {
  archiveNames,
  config,
  fixture,
  origin,
  run,
  runFailure,
  serveMockApi,
  state,
} from "./cli-fixture.js";
import { parseJson } from "./json.js";
import { testRuntime } from "./runtime.js";

serveMockApi();

describe("CLI journeys", () => {
  test("logs in without leaking the token in JSON", async () => {
    state.tokenPolls = 0;
    const fixtureRoot = await mkdtemp(join(tmpdir(), "cloud-login-"));
    const { runtime: current, output: captured } = testRuntime(
      fixtureRoot,
      join(fixtureRoot, "config"),
    );
    const output = captured.lines;
    await run(current, ["--api-url", origin, "--json", "--yes", "login"]);
    assert.equal(
      output.some((line) => line.includes("secret-token")),
      false,
    );
    assert.equal(
      (await readCredentials(current.configHome)).workspace,
      "workspace-1",
    );
  });

  test("keeps waiting for approval when no browser can be opened", async () => {
    state.tokenPolls = 0;
    const fixtureRoot = await mkdtemp(join(tmpdir(), "cloud-login-"));
    const { runtime: current, output: captured } = testRuntime(
      fixtureRoot,
      join(fixtureRoot, "config"),
    );
    const output = captured.lines;
    current.open = async () => {
      throw Object.assign(new Error("spawn xdg-open ENOENT"), {
        code: "ENOENT",
      });
    };
    await run(current, ["--api-url", origin, "login"]);
    assert.ok(
      output.some((line) => line.includes("No browser could be opened")),
    );
    assert.equal(
      (await readCredentials(current.configHome)).workspace,
      "workspace-1",
    );
  });

  test("reports a never-deployed service as not deployed", async () => {
    const current = await fixture();
    await run(current.runtime, ["status"]);
    const lines = current.output.join("\n");
    assert.match(lines, /^worker\tnot deployed\t-$/m);
    assert.match(lines, /^app\tdeploying\t-$/m);
    assert.equal(lines.includes("SERVICE"), false, "no header in a pipe");
    await run(current.runtime, ["--json", "status"]);
    assert.ok(
      current.output.some((line) => line.includes('"status":"not_deployed"')),
    );
  });

  test("links with the exact project file shape", async () => {
    const current = await fixture();
    await run(current.runtime, [
      "--json",
      "link",
      "demo",
      "--service",
      "api=apps/api",
    ]);
    const linked = parseJson(
      await readFile(join(current.root, ".antelope", "cloud.json"), "utf8"),
    );
    assert.deepEqual(linked, {
      workspace: "workspace-1",
      project: "project-1",
      services: { api: { path: "apps/api" } },
    });
  });

  test("link without --service names the services the project has", async () => {
    const current = await fixture();
    state.serviceNames = ["api", "worker"];
    const english = await runFailure(current.runtime, ["link", "demo"]);
    assert.equal(english.code, "unlinkable_service");
    assert.deepEqual(describeFailure(english, "en"), {
      title: 'The project has no service named "app"',
      reason:
        "Without --service, link expects the api and app services of a starter.",
      details: ["Available services: api, worker"],
      fixes: ["Pass --service <name>=<path> for each service of this folder"],
      exitCode: undefined,
    });
    const french = await runFailure(current.runtime, [
      "--lang",
      "fr",
      "link",
      "demo",
    ]);
    assert.deepEqual(describeFailure(french, "fr")?.details, [
      "Services disponibles : api, worker",
    ]);
    assert.equal(
      describeFailure(french, "fr")?.title,
      "Le projet n’a aucun service nommé « app »",
    );
    state.serviceNames = null;
  });

  test("link requires an existing project and production service without creating either", async () => {
    const current = await fixture();
    const requestStart = state.requests.length;
    await assert.rejects(
      run(current.runtime, ["link", "missing-project", "--service", "api=."]),
      { code: "unknown_project" },
    );
    await assert.rejects(
      run(current.runtime, ["link", "demo", "--service", "missing-service=."]),
      { code: "unlinkable_service" },
    );
    assert.ok(
      state.requests
        .slice(requestStart)
        .every((request) => request.startsWith("GET ")),
    );
    assert.deepEqual(await readProjectConfig(current.root), config());
  });

  test("deploys the inferred subdirectory and follows progress", async () => {
    const current = await fixture();
    current.runtime.cwd = join(current.root, "apps", "api");
    state.archive = null;
    await run(current.runtime, ["--json", "--yes", "deploy"]);
    assert.equal(
      state.requests.includes(
        "POST /api/cloud/services/service-api/source-deployments",
      ),
      true,
    );
    assert.equal(
      current.output.some((line) => line.includes('"type":"deploy_succeeded"')),
      true,
    );
    assert.ok(state.archive);
    assert.deepEqual(
      state.archive,
      await createSourceArchive(current.runtime.cwd),
    );
    assert.deepEqual(await archiveNames(state.archive), ["index.js"]);
  });

  test("deploys the services a service links to before it", async () => {
    const current = await fixture();
    state.links = { "service-api": ["service-app"] };
    const requestStart = state.requests.length;
    try {
      await run(current.runtime, ["--json", "--yes", "deploy"]);
    } finally {
      state.links = {};
    }
    assert.deepEqual(
      state.requests
        .slice(requestStart)
        .filter((request) => request.endsWith("/source-deployments")),
      [
        "POST /api/cloud/services/service-app/source-deployments",
        "POST /api/cloud/services/service-api/source-deployments",
      ],
    );
  });

  test("operates status, logs, open and rollback in CI mode", async () => {
    const current = await fixture();
    await run(current.runtime, ["--json", "--yes", "status"]);
    await run(current.runtime, ["--json", "--yes", "logs", "api", "-f"]);
    await run(current.runtime, ["--json", "--yes", "open", "api"]);
    await run(current.runtime, ["--json", "--yes", "rollback", "api"]);
    assert.equal(
      current.output.some((line) => line.includes('"type":"log"')),
      true,
    );
    assert.equal(
      current.output.some((line) =>
        line.includes('"type":"rollback_succeeded"'),
      ),
      true,
    );
    assert.equal(
      current.output.some((line) => line.includes("https://api.example.test")),
      true,
    );
  });

  test("reconnects log tails with the last cursor", async () => {
    const current = await fixture();
    state.reconnectLogs = true;
    state.logRequests = 0;
    state.lastEventId = null;
    await run(current.runtime, ["--json", "--yes", "logs", "api", "-f"]);
    state.reconnectLogs = false;
    assert.equal(state.logRequests, 2);
    assert.equal(state.lastEventId, "cursor-1");
  });
});
