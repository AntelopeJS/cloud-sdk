import assert from "node:assert/strict";
import { buffer } from "node:stream/consumers";
import { describe, test } from "node:test";
import { CloudApiError } from "@antelopejs/cloud-sdk";
import { describeApiError, describeFailure } from "../src/error-messages.js";
import { CliError } from "../src/errors.js";
import { parseVariableAssignment, variableWriteOf } from "../src/variables.js";
import { type JsonValue, jsonAt, parseJson } from "./json.js";
import {
  fixture,
  json,
  reply,
  requests,
  routes,
  run,
  serveMockApi,
  types,
} from "./ux-fixture.js";

serveMockApi();

const ENVIRONMENT = "/api/cloud/projects/project-1/environments/environment-1";
const VARIABLES_PATH = `${ENVIRONMENT}/variables`;
const SITE_URL_PATH = `${ENVIRONMENT}/services/service-web/variables/NEXT_PUBLIC_SITE_URL`;
const MARKED = {
  serviceId: "service-web",
  key: "NEXT_PUBLIC_SITE_URL",
  secret: false,
  value: "https://one.example",
  buildTime: true,
  origin: { type: "manual" },
};

/** The environment's variables as the API lists them: marked, secret, wired from an older API. */
function listed(): JsonValue {
  return {
    variables: [
      MARKED,
      {
        serviceId: "service-web",
        key: "API_KEY",
        secret: true,
        value: null,
        buildTime: false,
        origin: { type: "manual" },
      },
      {
        serviceId: "service-web",
        key: "MONGO_URL",
        secret: false,
        value: null,
        origin: {
          type: "resource",
          serviceId: "service-db",
          publishedKey: "MONGO_URL",
        },
      },
    ],
  };
}

/** Answers a write with the marked row and keeps the body it received. */
function recordedWrite(bodies: string[]) {
  routes[`PUT ${SITE_URL_PATH}`] = async (request, response) => {
    bodies.push((await buffer(request)).toString("utf8"));
    json(response, 200, MARKED);
  };
}

describe("env list", () => {
  test("lists each variable with its value, its mask or its publisher, and whether the builds get it", async () => {
    const current = await fixture();
    routes[VARIABLES_PATH] = reply(200, listed());
    await run(current.runtime, ["env", "list"]);
    assert.deepEqual(current.output, [
      "web\tAPI_KEY\t(secret)\truntime",
      "web\tMONGO_URL\twired from service-db\truntime",
      "web\tNEXT_PUBLIC_SITE_URL\thttps://one.example\tbuild and runtime",
    ]);
  });

  test("names the service, filters on it, and keeps the mark in the JSON record", async () => {
    const current = await fixture();
    routes[VARIABLES_PATH] = reply(200, listed());
    await run(current.runtime, ["--json", "env", "list", "web"]);
    assert.deepEqual(types(current.output), ["variables"]);
    const record = parseJson(current.output[0] ?? "");
    assert.equal(jsonAt(record, "data", "environment"), "production");
    const variables = jsonAt(record, "data", "variables");
    assert.ok(Array.isArray(variables));
    assert.deepEqual(
      variables.map((row) => [
        jsonAt(row, "service"),
        jsonAt(row, "key"),
        jsonAt(row, "buildTime"),
      ]),
      [
        ["web", "API_KEY", false],
        ["web", "MONGO_URL", false],
        ["web", "NEXT_PUBLIC_SITE_URL", true],
      ],
    );
    await assert.rejects(
      run(current.runtime, ["env", "list", "worker"]),
      (error) => error instanceof CliError && error.code === "unknown_service",
    );
  });

  test("says when a service holds no variable", async () => {
    const current = await fixture();
    routes[VARIABLES_PATH] = reply(200, { variables: [] });
    await run(current.runtime, ["--lang", "fr", "env", "list"]);
    assert.deepEqual(current.output, ["ℹ Aucune variable"]);
  });
});

describe("env set", () => {
  test("marks a visible value as available at build time, says it is public, and answers the row", async () => {
    const current = await fixture();
    const bodies: string[] = [];
    recordedWrite(bodies);
    await run(current.runtime, [
      "env",
      "set",
      "web",
      "NEXT_PUBLIC_SITE_URL=https://one.example",
      "--build-time",
    ]);
    assert.deepEqual(bodies.map(parseJson), [
      { value: "https://one.example", secret: false, buildTime: true },
    ]);
    assert.deepEqual(current.output, [
      "✔ NEXT_PUBLIC_SITE_URL set on web: the next deployment reads it",
      "▲ NEXT_PUBLIC_SITE_URL is public: its value is written into the image, where anyone who can pull it reads it",
    ]);
  });

  test("a secret by default, a visible value with --plain, and --no-build-time clears the mark", async () => {
    const current = await fixture();
    const bodies: string[] = [];
    recordedWrite(bodies);
    const assignment = "NEXT_PUBLIC_SITE_URL=https://one.example?a=b";
    await run(current.runtime, ["--json", "env", "set", "web", assignment]);
    await run(current.runtime, [
      "--json",
      "env",
      "set",
      "web",
      assignment,
      "--plain",
    ]);
    await run(current.runtime, [
      "--json",
      "env",
      "set",
      "web",
      assignment,
      "--no-build-time",
    ]);
    assert.deepEqual(bodies.map(parseJson), [
      { value: "https://one.example?a=b" },
      { value: "https://one.example?a=b", secret: false },
      { value: "https://one.example?a=b", buildTime: false },
    ]);
    assert.deepEqual(types(current.output), [
      "variable_set",
      "build_time_public",
      "variable_set",
      "build_time_public",
      "variable_set",
      "build_time_public",
    ]);
    assert.equal(
      jsonAt(parseJson(current.output[0] ?? ""), "data", "buildTime"),
      true,
    );
  });
});

describe("env set: what is refused", () => {
  test("refuses a name or a value the API would refuse, before any request", async () => {
    const refusedNames = [
      "NODE_ENV",
      "HTTP_PROXY",
      "BUILDKIT_SYNTAX",
      "next_public_url",
      "1URL",
      "A-B",
    ];
    for (const name of refusedNames) {
      assert.throws(
        () => parseVariableAssignment(`${name}=x`, { buildTime: true }),
        (error) =>
          error instanceof CliError &&
          error.code === "invalid_build_time_name" &&
          error.detail === name,
        name,
      );
      assert.deepEqual(parseVariableAssignment(`${name}=x`), {
        key: name,
        value: "x",
      });
    }
    for (const value of ["a\nb", "a\tb", "x".repeat(1025)]) {
      assert.throws(
        () => parseVariableAssignment(`URL=${value}`, { buildTime: true }),
        (error) =>
          error instanceof CliError &&
          error.code === "invalid_build_time_value" &&
          error.detail === "URL",
      );
    }
    assert.deepEqual(
      parseVariableAssignment(`_URL=${"é".repeat(1024)}`, { buildTime: true }),
      { key: "_URL", value: "é".repeat(1024) },
    );
    for (const text of ["URL", "URL=", "=x", ""]) {
      assert.throws(
        () => parseVariableAssignment(text),
        (error) =>
          error instanceof CliError &&
          error.code === "invalid_variable_assignment" &&
          error.detail !== "x",
        text,
      );
    }
    assert.deepEqual(variableWriteOf({ key: "K", value: "v" }, {}), {
      value: "v",
    });

    const current = await fixture();
    const before = requests.length;
    await assert.rejects(
      run(current.runtime, [
        "env",
        "set",
        "web",
        "NODE_ENV=test",
        "--build-time",
      ]),
      (error) =>
        error instanceof CliError &&
        error.code === "invalid_build_time_name" &&
        describeFailure(error, "en")?.exitCode === 2,
    );
    assert.equal(requests.length, before);
  });

  test("a refused mark is told in both languages", () => {
    const secret = new CloudApiError(
      400,
      "cloud.errors.settings.entry.build_time_secret",
    );
    assert.equal(
      describeApiError(secret, "en").title,
      "A secret is never available at build time",
    );
    assert.equal(
      describeApiError(secret, "fr").title,
      "Un secret n’est jamais disponible au build",
    );
    const limit = new CloudApiError(
      409,
      "cloud.errors.settings.build_time_limit",
    );
    assert.match(describeApiError(limit, "en").reason ?? "", /32 variables/);
    assert.match(describeApiError(limit, "fr").reason ?? "", /32 variables/);
  });
});

describe("env unset", () => {
  test("removes the variable at its path and says so", async () => {
    const current = await fixture();
    routes[`DELETE ${SITE_URL_PATH}`] = (_, response) => {
      response.writeHead(200);
      response.end();
    };
    await run(current.runtime, ["env", "unset", "web", "NEXT_PUBLIC_SITE_URL"]);
    assert.deepEqual(current.output, [
      "✔ NEXT_PUBLIC_SITE_URL removed from web",
    ]);
    await run(current.runtime, [
      "--json",
      "env",
      "unset",
      "web",
      "NEXT_PUBLIC_SITE_URL",
    ]);
    assert.deepEqual(types(current.output.slice(1)), ["variable_removed"]);
    assert.ok(requests.includes(`DELETE ${SITE_URL_PATH}`));
  });
});
