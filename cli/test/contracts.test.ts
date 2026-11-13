import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { CloudApiError, parseSse } from "@antelopejs/cloud-sdk";
import { Command } from "commander";
import { cloudApi } from "../src/api.js";
import { createSourceArchive } from "../src/archive.js";
import { mountCloudCommand } from "../src/command.js";
import { readProjectConfig, writeProjectConfig } from "../src/config.js";
import { describeApiError } from "../src/error-messages.js";
import {
  parseServicePaths,
  resolveServiceRoot,
  selectedServiceNames,
  withServiceDockerfiles,
} from "../src/project.js";
import {
  archiveContents,
  archiveNames,
  config,
  credentials,
  fixture,
  progressFrames,
  run,
  runBinary,
  serveMockApi,
  state,
} from "./cli-fixture.js";
import { jsonAt, parseJson, textAt } from "./json.js";

serveMockApi();

describe("contracts", () => {
  test("uploads only the supplied Buffer slice as a source tar file", async () => {
    const backing = Buffer.from([99, 0, 255, 13, 10, 42, 88]);
    const archive = backing.subarray(1, -1);
    const receipt = await cloudApi(credentials()).deploy(
      "service/api",
      archive,
    );
    assert.deepEqual(state.archive, archive);
    assert.equal(receipt.buildId, "build-1");
    assert.equal(receipt.status, "queued");
    assert.ok(
      state.requests.includes(
        "POST /api/cloud/services/service%2Fapi/source-deployments",
      ),
    );
  });

  test("mounts one cloud command into ajs", () => {
    const root = new Command("ajs");
    mountCloudCommand(root);
    assert.equal(root.commands[0]?.name(), "cloud");
  });

  test("selects all services at root and one service below its path", () => {
    assert.deepEqual(selectedServiceNames(config(), "/repo", "/repo"), [
      "api",
      "app",
    ]);
    assert.deepEqual(
      selectedServiceNames(config(), "/repo", "/repo/apps/api/src"),
      ["api"],
    );
    const nested = config();
    nested.services.root = { path: "." };
    assert.deepEqual(
      selectedServiceNames(nested, "/repo", "/repo/apps/api/src"),
      ["api"],
    );
  });

  test("rejects service paths outside the real project root", async () => {
    assert.throws(
      () => parseServicePaths(["api=../private"]),
      /service_path_outside_project/,
    );
    const root = await mkdtemp(join(tmpdir(), "cloud-path-"));
    const outside = await mkdtemp(join(tmpdir(), "cloud-outside-"));
    await import("node:fs/promises").then(({ symlink }) =>
      symlink(outside, join(root, "linked")),
    );
    await assert.rejects(
      resolveServiceRoot(root, "linked"),
      /service_path_outside_project/,
    );
  });

  test("rejects malformed hand-edited project config", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloud-config-"));
    await mkdir(join(root, ".antelope"));
    await writeFile(
      join(root, ".antelope", "cloud.json"),
      JSON.stringify({ workspace: "w", project: "p", services: { api: {} } }),
    );
    await assert.rejects(readProjectConfig(root), /invalid_project_config/);
  });

  test("honours .cloudignore in deterministic tarballs", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "cloud-archive-"));
    await mkdir(join(root, "ignored"));
    await writeFile(join(root, "keep.txt"), "keep");
    await writeFile(join(root, "ignored", "secret.txt"), "secret");
    await writeFile(join(root, ".cloudignore"), "ignored\n");
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const archive = await createSourceArchive(root);
    assert.deepEqual(await archiveNames(archive), [".cloudignore", "keep.txt"]);
    t.mock.timers.setTime(2_000_000);
    await utimes(join(root, "keep.txt"), 1, 2);
    assert.deepEqual(await createSourceArchive(root), archive);
  });
});

describe("contracts: Dockerfiles and streams", () => {
  test("refuses a Dockerfile read from the project file that leaves the service folder", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cloud-dockerfile-escape-"));
    const root = join(parent, "service");
    await mkdir(root);
    await mkdir(join(parent, "outside"));
    await writeFile(join(root, "index.js"), "");
    await writeFile(join(parent, "outside", "secret"), "not for upload");
    await assert.rejects(
      createSourceArchive(root, "../outside/secret"),
      /service_path_outside_project/,
    );
    const linked = await symlink(
      join(parent, "outside"),
      join(root, "linked"),
      "junction",
    ).then(
      () => true,
      () => false,
    );
    if (linked) {
      await assert.rejects(
        createSourceArchive(root, "linked/secret"),
        /service_path_outside_project/,
      );
    }
  });

  test("ends a stream whose frame never ends, before it fills memory", async () => {
    const chunk = "x".repeat(65_536);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const read = async (): Promise<void> => {
      for await (const event of parseSse(new Response(endless))) void event;
    };
    await assert.rejects(read(), /invalid_api_response/);
    assert.ok(sent <= 32, `read ${sent} chunks before stopping`);
  });

  test("packs a service's own Dockerfile as the archive's Dockerfile", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloud-dockerfile-"));
    await writeFile(join(root, "Dockerfile"), "FROM backend\n");
    await writeFile(join(root, "frontend.Dockerfile"), "FROM frontend\n");
    await writeFile(join(root, "package.json"), "{}");
    const archive = await createSourceArchive(root, "frontend.Dockerfile");
    const contents = await archiveContents(archive);
    assert.equal(contents.Dockerfile, "FROM frontend\n");
    assert.equal(contents["package.json"], "{}");
    const plain = await archiveContents(await createSourceArchive(root));
    assert.equal(plain.Dockerfile, "FROM backend\n");
  });

  test("links two services of one folder with their own Dockerfiles", async () => {
    const current = await fixture();
    await run(current.runtime, [
      "--json",
      "link",
      "demo",
      "--service",
      "api=.",
      "--dockerfile",
      "api=docker/api.Dockerfile",
    ]);
    const linked = parseJson(
      await readFile(join(current.root, ".antelope", "cloud.json"), "utf8"),
    );
    assert.deepEqual(jsonAt(linked, "services"), {
      api: { path: ".", dockerfile: "docker/api.Dockerfile" },
    });
    assert.throws(
      () => withServiceDockerfiles({ api: { path: "." } }, ["web=Dockerfile"]),
      /invalid_service_dockerfile/,
    );
    assert.throws(
      () =>
        withServiceDockerfiles({ api: { path: "." } }, ["api=../Dockerfile"]),
      /service_path_outside_project/,
    );
  });
});

describe("contracts: SSE, binary errors and messages", () => {
  test("parses split and final SSE frames", async () => {
    const response = new Response(progressFrames(), {
      headers: { "content-type": "text/event-stream" },
    });
    const events = [];
    for await (const event of parseSse(response)) events.push(event);
    assert.deepEqual(
      events.map((event) => event.event),
      ["state", "status-changed"],
    );
    const truncated = new Response('event: log\ndata: {"message":"partial"}');
    const discarded = [];
    for await (const event of parseSse(truncated)) discarded.push(event);
    assert.deepEqual(discarded, []);
  });

  test("emits one JSON error from the real binary for invalid CI usage", async () => {
    const result = await runBinary(["--json", "deplyo"]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    const error = parseJson(result.stderr);
    assert.equal(jsonAt(error, "version"), 1);
    assert.equal(jsonAt(error, "type"), "error");
    assert.equal(jsonAt(error, "error", "code"), "commander.unknownCommand");
  });

  test("emits a localized structured quota error from the real binary", async () => {
    const current = await fixture();
    await writeProjectConfig(current.root, {
      ...config(),
      project: "quota",
    });
    const result = await runBinary(
      ["--json", "--yes", "--lang", "fr", "status"],
      current.root,
      { ...process.env, XDG_CONFIG_HOME: current.runtime.configHome },
    );
    const error = parseJson(result.stderr);
    assert.equal(result.status, 1);
    assert.equal(jsonAt(error, "error", "code"), "cloud.errors.services.limit");
    assert.match(textAt(error, "error", "message"), /quota/i);
    assert.equal(jsonAt(error, "error", "status"), 429);
  });

  test("renders quota, permission and plan failures in both languages", () => {
    assert.match(
      describeApiError(new CloudApiError(429, "quota_exceeded"), "en").title,
      /quota/i,
    );
    assert.match(
      describeApiError(new CloudApiError(403, "forbidden"), "fr").title,
      /autorisation/i,
    );
    assert.match(
      describeApiError(new CloudApiError(403, "plan_required"), "fr").title,
      /forfait/i,
    );
    const limit = describeApiError(
      new CloudApiError(409, "cloud.errors.limits.projects_per_workspace"),
      "en",
    );
    assert.equal(limit.title, "The workspace has reached its project limit");
    assert.deepEqual(limit.details, [
      "cloud.errors.limits.projects_per_workspace (HTTP 409)",
    ]);
    assert.equal(limit.fixes?.[0], "Upgrade the plan");
  });
});
