import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(
  new URL("check-package-hosts.mjs", import.meta.url),
);
const root = mkdtempSync(path.join(tmpdir(), "package-hosts-test-"));

/**
 * A host under one of our domains that no deployment answers on, joined at
 * run time so the tracked tree never names a non-production host of ours.
 * @param {...string} labels
 */
const ownHost = (...labels) => labels.join(".");
const LEGACY = ownHost("legacy", "antelopejs", "com");
const UNLISTED = ownHost("unlisted", "antelopejs", "cloud");
const UNLISTED_EVENTS = ownHost("events", "unlisted", "antelopejs", "cloud");

/**
 * A package directory whose only module says `text`.
 * @param {string} name
 * @param {string} text
 */
function packageSaying(name, text) {
  const directory = path.join(root, name);
  mkdirSync(directory);
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ name, version: "1.0.0", files: ["index.js"] }),
  );
  writeFileSync(path.join(directory, "index.js"), `${text}\n`);
  return directory;
}

/** @param {string} directory */
function check(directory) {
  return spawnSync(process.execPath, [CHECK, directory], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("check-package-hosts", () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it("passes a package that names only production and reserved hosts", () => {
    const result = check(
      packageSaying(
        "prod",
        'fetch("https://api.antelopejs.cloud/x"); "https://shop.antelopejs.io"; "http://api.example.test"',
      ),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  });

  it("passes a package that ships the Apache-2.0 license text", () => {
    const result = check(
      packageSaying(
        "licensed",
        "                              http://www.apache.org/licenses/",
      ),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  });

  it("fails a package that names a staging endpoint", () => {
    const result = check(
      packageSaying(
        "staged",
        'const url = "https://api-staging.example.test";',
      ),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /staged\/index\.js:1: names staging/);
  });

  it("fails a non-production host that does not say staging", () => {
    const result = check(
      packageSaying("legacy", `servers: [{ url: 'https://${LEGACY}' }]`),
    );
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `legacy/index.js:1: names host ${LEGACY}`,
    );
  });

  it("fails a host named without a scheme, another scheme or behind userinfo", () => {
    const result = check(
      packageSaying(
        "hidden",
        [
          `const host = "${UNLISTED}"; const url = \`https://\${host}\`;`,
          `const events = "wss://${UNLISTED_EVENTS}/stream";`,
          'const spoof = "https://api.antelopejs.cloud@evil.net/x";',
          'const local = "http://localhost:5010";',
        ].join("\n"),
      ),
    );
    assert.equal(result.status, 1);
    assert.deepEqual(result.stderr.trim().split("\n"), [
      `hidden/index.js:1: names host ${UNLISTED}`,
      `hidden/index.js:2: names host ${UNLISTED_EVENTS}`,
      "hidden/index.js:3: names host evil.net",
      "hidden/index.js:4: names host localhost",
    ]);
  });

  it("reads the host up to the punctuation or template that follows it", () => {
    const result = check(
      packageSaying(
        "trailing",
        [
          "see https://evil.net, for details",
          "const local = `http://localhost:${port}/x`;",
          'const loopback = "http://[::1]:5010/x";',
          "const prod = `https://api.antelopejs.cloud${path}`;",
        ].join("\n"),
      ),
    );
    assert.equal(result.status, 1);
    assert.deepEqual(result.stderr.trim().split("\n"), [
      "trailing/index.js:1: names host evil.net",
      "trailing/index.js:2: names host localhost",
      "trailing/index.js:3: names host [::1]",
    ]);
  });

  it("keeps userinfo, underscores, ellipses and templates from hiding a host", () => {
    const result = check(
      packageSaying(
        "edges",
        [
          "See [docs](https://evil.net),[mail](mailto:support@example.com).",
          "https://evil.net,admin@example.com",
          'const feed = "https://team@ops@db.evil.net/feed";',
          'const db = "http://test_db:5432/app";',
          "see https://api.antelopejs.cloud... for more",
          'const u = `${secure ? "wss" : "ws"}://localhost:${port}/events`;',
          "const u = `https://${bucket}.s3.amazonaws.com/${key}`;",
        ].join("\n"),
      ),
    );
    assert.equal(result.status, 1);
    assert.deepEqual(result.stderr.trim().split("\n"), [
      "edges/index.js:1: names host evil.net",
      "edges/index.js:2: names host evil.net",
      "edges/index.js:3: names host db.evil.net",
      "edges/index.js:4: names host test_db",
      "edges/index.js:6: names host localhost",
      "edges/index.js:7: names host s3.amazonaws.com",
    ]);
  });
});
