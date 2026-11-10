import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readCredentials, writeCredentials } from "../src/config.js";
import {
  credentials,
  fixture,
  origin,
  otherOrigin,
  otherRequests,
  run,
  runBinary,
  serveMockApi,
  state,
} from "./cli-fixture.js";
import { jsonAt, parseJson, textAt } from "./json.js";

serveMockApi();

const authenticatedCommands = [
  ["link", "demo"],
  ["deploy", "api"],
  ["status"],
  ["logs", "api", "-f"],
  ["open", "api"],
  ["rollback", "api"],
];

describe("API endpoint session binding", () => {
  for (const source of ["flag", "env"]) {
    for (const command of authenticatedCommands) {
      test(`${source} mismatch blocks ${command[0]} before any request`, async () => {
        const current = await fixture();
        state.requests = [];
        otherRequests.length = 0;
        const args = source === "flag" ? ["--api-url", otherOrigin] : [];
        const env: NodeJS.ProcessEnv = {
          XDG_CONFIG_HOME: current.runtime.configHome,
        };
        if (source === "env") env.ANTELOPE_CLOUD_URL = otherOrigin;
        const result = await runBinary(
          ["--json", "--yes", ...args, ...command],
          current.root,
          env,
        );
        assert.deepEqual(state.requests, [], "stored endpoint contacted");
        assert.deepEqual(otherRequests, [], "override endpoint contacted");
        assert.equal(result.status, 1);
        const error = jsonAt(parseJson(result.stderr), "error");
        assert.equal(jsonAt(error, "code"), "api_url_mismatch");
        assert.match(
          textAt(error, "message"),
          /logged in to another API endpoint/i,
        );
        assert.equal(result.stdout, "");
      });
    }
  }
});

describe("equivalent API endpoints", () => {
  for (const source of ["flag", "env"]) {
    for (const command of [
      ["link", "demo"],
      ["rollback", "api"],
    ]) {
      test(`${source} allows normalized endpoint for ${command[0]}`, async () => {
        const current = await fixture();
        state.requests = [];
        otherRequests.length = 0;
        const apiUrl = `${origin.replace("http:", "HTTP:")}/`;
        const args = source === "flag" ? ["--api-url", apiUrl] : [];
        const result = await runBinary(
          ["--json", "--yes", ...args, ...command],
          current.root,
          {
            XDG_CONFIG_HOME: current.runtime.configHome,
            ANTELOPE_CLOUD_URL: source === "env" ? apiUrl : otherOrigin,
          },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.ok(state.requests.length > 0);
        assert.deepEqual(otherRequests, []);
      });
    }
  }
});

describe("API URL normalization", () => {
  test("normalizes host case and default port without changing the session", async () => {
    const current = await fixture();
    const saved = {
      ...credentials(),
      apiUrl: "https://EXAMPLE.test:443/base/",
    };
    await writeCredentials(current.runtime.configHome, saved);
    await run(current.runtime, [
      "--yes",
      "--api-url",
      "https://example.test/base",
      "open",
    ]);
    assert.deepEqual(await readCredentials(current.runtime.configHome), saved);
  });
});

describe("invalid or distinct API endpoints", () => {
  const overrides = {
    path: (url) => `${url}/different`,
    scheme: (url) => url.replace("http:", "https:"),
    query: (url) => `${url}?key=example`,
    fragment: (url) => `${url}#example`,
    userinfo: (url) => url.replace("http://", "http://user:password@"),
    protocol: (url) => url.replace("http:", "file:"),
    malformed: () => "not-a-url",
  } satisfies Record<string, (url: string) => string>;
  for (const [kind, override] of Object.entries(overrides)) {
    test(`rejects ${kind} without sending a request`, async () => {
      const current = await fixture();
      state.requests = [];
      otherRequests.length = 0;
      const result = await runBinary(
        ["--json", "--yes", "--api-url", override(origin), "status"],
        current.root,
        { XDG_CONFIG_HOME: current.runtime.configHome },
      );
      const code = textAt(parseJson(result.stderr), "error", "code");
      assert.match(code, /^(api_url_mismatch|invalid_api_url)$/);
      assert.equal(result.status, code === "invalid_api_url" ? 2 : 1);
      assert.deepEqual(state.requests, []);
      assert.deepEqual(otherRequests, []);
      assert.equal(result.stderr.includes("password"), false);
    });
  }
});
