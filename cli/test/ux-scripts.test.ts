import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, test } from "node:test";
import { CloudApiError } from "@antelopejs/cloud-sdk";
import { describeApiError, describeFailure } from "../src/error-messages.js";
import { CliError } from "../src/errors.js";
import { formatDuration } from "../src/progress.js";
import { jsonAt, parseJson, textAt } from "./json.js";
import {
  HISTORY_PATH,
  fixture,
  refusedUpload,
  reply,
  requests,
  rollingOutRevision,
  routes,
  run,
  runBinary,
  serveMockApi,
  told,
} from "./ux-fixture.js";

serveMockApi();

describe("readable errors", () => {
  test("local failure codes read as problems in both languages", () => {
    assert.deepEqual(
      describeFailure(new CliError("unknown_service", "api"), "en"),
      {
        title: 'The project has no service named "api"',
        reason: undefined,
        details: undefined,
        fixes: ["Run ajs-cloud status to list its services"],
        exitCode: undefined,
      },
    );
    assert.match(
      told(new CliError("rollback_revision_unavailable", "web"), "fr"),
      /Aucune révision antérieure de web/,
    );
    assert.equal(
      describeFailure(new CliError("invalid_timeout", "abc"), "en")?.exitCode,
      2,
    );
    const offline = describeFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      }),
      "en",
    );
    assert.equal(offline?.title, "Cannot reach AntelopeJS Cloud");
    assert.deepEqual(offline?.details, ["ECONNREFUSED"]);
  });

  test("a deleted project points to link or a new deploy", () => {
    const error = new CloudApiError(
      404,
      "cloud.errors.project.unknown_project",
    );
    assert.match(told(error), /no longer exists.*ajs-cloud link/);
  });

  test("an unknown API refusal still names its code", () => {
    const error = new CloudApiError(422, "cloud.errors.something_new");
    assert.deepEqual(describeApiError(error, "en"), {
      title: "The API refused the request",
      reason: undefined,
      fixes: undefined,
      details: ["cloud.errors.something_new (HTTP 422)"],
    });
  });

  test("a deployment receipt in another shape is refused and told in both languages", async () => {
    const current = await fixture();
    routes["/api/cloud/services/service-web/source-deployments"] =
      refusedUpload(202, { deploymentId: "deployment-1" });
    await assert.rejects(run(current.runtime, ["deploy"]), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "invalid_api_response");
      assert.match(told(error), /answer the CLI cannot read/);
      assert.match(told(error, "fr"), /réponse illisible/);
      return true;
    });
  });

  test("durations read in minutes and seconds", () => {
    assert.equal(formatDuration(4_400), "4s");
    assert.equal(formatDuration(92_000), "1m 32s");
  });
});

describe("C9: scripts, pipes and exit codes", () => {
  test("a bare invocation prints the help on stdout and succeeds", async () => {
    const result = await runBinary([]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^ajs-cloud \d+\.\d+\.\d+/);
    assert.match(result.stdout, /Commands:/);
    assert.equal(result.stderr, "");
  });

  test("help environment lists the variables the CLI reads", async () => {
    const result = await runBinary(["help", "environment"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ANTELOPE_CLOUD_URL/);
    assert.match(result.stdout, /XDG_CONFIG_HOME/);
  });

  test("a rollback nobody can confirm names --yes instead of hanging", async () => {
    const current = await fixture();
    routes[HISTORY_PATH] = reply(200, {
      revisions: [rollingOutRevision("superseded")].map((revision) => ({
        ...revision,
        canRollback: true,
      })),
      desiredRevisionId: null,
    });
    const result = await runBinary(["rollback", "web"], current);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ajs-cloud rollback web --yes/);
    assert.ok(!requests.some((request) => request.startsWith("POST ")));
  });

  test("a first deploy nobody can answer names its flags before any write", async () => {
    const current = await fixture({ isLinked: false });
    const result = await runBinary(["deploy"], current);
    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /ajs-cloud deploy --project <name> --port <port> --yes/,
    );
    assert.ok(!requests.some((request) => request.startsWith("POST ")));
  });

  test("an invalid option fails with the usage code before any request", async () => {
    const current = await fixture();
    const result = await runBinary(["deploy", "--port", "99999"], current);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid port "99999"/);
    assert.deepEqual(requests, []);
  });

  test("a build refusal reads as what, why and how to fix, values filled", async () => {
    const current = await fixture();
    routes["/api/cloud/services/service-web/source-deployments"] =
      refusedUpload(422, {
        message: "cloud.errors.builds.node_version_unsupported",
        params: { requested: ">=26", supported: "20, 22, 24" },
      });
    const human = await runBinary(["deploy"], current);
    assert.equal(human.status, 1);
    assert.equal(human.stdout, "");
    assert.match(human.stderr, /No supported Node\.js version matches >=26/);
    assert.match(human.stderr, /Supported versions: 20, 22, 24\./);
    assert.match(human.stderr, /engines\.node/);
    assert.match(
      human.stderr,
      /cloud\.errors\.builds\.node_version_unsupported \(HTTP 422\)/,
    );
    assert.doesNotMatch(human.stderr, /\{requested\}|\{supported\}/);
    const machine = await runBinary(["--json", "deploy"], current);
    const error = parseJson(machine.stderr.trim().split("\n").at(-1) ?? "");
    assert.equal(machine.status, 1);
    assert.equal(
      jsonAt(error, "error", "code"),
      "cloud.errors.builds.node_version_unsupported",
    );
    assert.equal(jsonAt(error, "error", "status"), 422);
    assert.match(
      textAt(error, "error", "message"),
      /No supported Node\.js version matches >=26/,
    );
  });

  test("a build refusal sent as a bare key still names its fix", async () => {
    const current = await fixture();
    routes["/api/cloud/services/service-web/source-deployments"] =
      refusedUpload(422, "cloud.errors.builds.missing_start_script");
    const result = await runBinary(["deploy"], current);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /package\.json has no start script/);
    assert.match(result.stderr, /"start": "npx serve dist"/);
  });

  test("a quiet deploy prints only its public URL", async () => {
    const current = await fixture();
    const result = await runBinary(["deploy", "-q"], current);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "https://web.example.test\n");
    assert.equal(result.stderr, "");
  });

  test("a declined rollback changes nothing", async () => {
    const current = await fixture();
    routes[HISTORY_PATH] = reply(200, {
      revisions: [{ ...rollingOutRevision("superseded"), canRollback: true }],
      desiredRevisionId: null,
    });
    current.answers.confirms.push(false);
    await run(current.runtime, ["rollback", "web"]);
    assert.deepEqual(current.output, ["– Nothing was changed"]);
    assert.ok(!requests.some((request) => request.startsWith("POST ")));
  });
});

describe("C10: start-up cost", () => {
  const hook = [
    'import { registerHooks } from "node:module";',
    "registerHooks({ resolve(specifier, context, next) {",
    "  const resolved = next(specifier, context);",
    '  process.stderr.write("LOAD " + resolved.url + "\\n");',
    "  return resolved;",
    "} });",
  ].join("\n");

  test("--help loads neither the actions nor the API client", async (context) => {
    const nodeModule = await import("node:module");
    if (!("registerHooks" in nodeModule))
      return context.skip("module hooks need Node.js 22.15");
    const result = await new Promise<string>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          `data:text/javascript,${encodeURIComponent(hook)}`,
          join(process.cwd(), "dist", "bin.js"),
          "--help",
        ],
        { env: { PATH: process.env.PATH } },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("close", () => resolve(stderr));
    });
    assert.match(result, /dist\/command\.js/);
    for (const heavy of ["actions.js", "api.js", "openapi-fetch", "tar-stream"])
      assert.equal(result.includes(heavy), false, heavy);
  });
});
