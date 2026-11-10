import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHECK = fileURLToPath(
  new URL("check-repository-hosts.mjs", import.meta.url),
);
const root = mkdtempSync(path.join(tmpdir(), "repository-hosts-test-"));

/**
 * A private host for a fixture, joined at run time so this file does not fail
 * the scan it tests.
 * @param {...string} labels
 */
const host = (...labels) => labels.join(".");
const UNLISTED = host("unlisted", "antelopejs", "cloud");
const REGISTRY = host("registry", "unlisted", "antelopejs", "cloud");
const STAGED = host("shop-staging", "acme", "dev");
const CLUSTER = host("db", "cluster", "internal");
const PRIVATE_ADDRESS = host("10", "0", "3", "17");
const APP_STAGED = host("api", "staging", "antelopejs", "io");
const SERVICE = host("cloud-api", "cloud", "svc", "cluster", "local");
const NODE_ADDRESS = host("10", "0", "12", "7");
const SHARED_ADDRESS = host("100", "64", "1", "2");
const METADATA_ADDRESS = host("169", "254", "169", "254");
const UNIQUE_LOCAL = ["[fd00", ":1]"].join(":");
const TAILNET = host("box", "tailnet-1234", "ts", "net");

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
}

/**
 * A repository with one commit per entry, each writing its files and
 * committing them with its message.
 * @param {string} name
 * @param {{ files: Record<string, string>, message: string }[]} commits
 */
function repository(name, commits) {
  const directory = path.join(root, name);
  git(root, ["init", "--quiet", "--initial-branch=main", name]);
  for (const { files, message } of commits) {
    for (const [file, text] of Object.entries(files))
      writeFileSync(path.join(directory, file), text);
    git(directory, ["add", "--all"]);
    git(directory, ["commit", "--quiet", "--message", message]);
  }
  return directory;
}

/** @param {string} directory */
function check(directory) {
  return spawnSync(process.execPath, [CHECK], {
    cwd: directory,
    encoding: "utf8",
  });
}

/**
 * The short id of a commit, as findings name it.
 * @param {string} directory
 * @param {string} revision
 */
function commitOf(directory, revision) {
  return git(directory, ["rev-parse", revision]).trim().slice(0, 12);
}

describe("check-repository-hosts", () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it("passes production, reserved, loopback and third-party hosts", () => {
    const directory = repository("clean", [
      {
        files: {
          "README.md": [
            "The client talks to https://api.antelopejs.cloud by default.",
            "A service answers on https://shop.antelopejs.io.",
            "Tests use http://127.0.0.1:5010, http://localhost and https://api.example.test.",
            "Archives go to https://bucket.s3.amazonaws.com.",
          ].join("\n"),
        },
        message: "docs: name the hosts a reader may use",
      },
    ]);
    const result = check(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  });

  it("fails a tracked file that names a private host", () => {
    const directory = repository("tree", [
      {
        files: {
          "config.ts": [
            `export const api = "https://${UNLISTED}";`,
            `export const shop = "https://${STAGED}";`,
            `export const db = "postgres://${CLUSTER}:5432/app";`,
            `export const node = "http://${PRIVATE_ADDRESS}:8080";`,
          ].join("\n"),
        },
        message: "feat: add the endpoints",
      },
    ]);
    const result = check(directory);
    const commit = commitOf(directory, "HEAD");
    assert.equal(result.status, 1);
    assert.deepEqual(result.stderr.trim().split("\n"), [
      `config.ts:1: names host ${UNLISTED}`,
      `config.ts:2: names host ${STAGED}`,
      `config.ts:3: names host ${CLUSTER}`,
      `config.ts:4: names host ${PRIVATE_ADDRESS}`,
      `${commit}:config.ts: names host ${UNLISTED}`,
      `${commit}:config.ts: names host ${STAGED}`,
      `${commit}:config.ts: names host ${CLUSTER}`,
      `${commit}:config.ts: names host ${PRIVATE_ADDRESS}`,
    ]);
  });

  it("fails staging under the app domain, and private hosts written without a scheme", () => {
    const directory = repository("schemeless", [
      {
        files: {
          "values.yaml": [
            `apiUrl: https://${APP_STAGED}`,
            `upstream: ${SERVICE}:8080`,
            `kubeServer: ${NODE_ADDRESS}:6443`,
          ].join("\n"),
        },
        message: "chore: add the values",
      },
    ]);
    const result = check(directory);
    const commit = commitOf(directory, "HEAD");
    assert.equal(result.status, 1);
    assert.deepEqual(result.stderr.trim().split("\n"), [
      `values.yaml:1: names host ${APP_STAGED}`,
      `values.yaml:2: names host ${SERVICE}`,
      `values.yaml:3: names host ${NODE_ADDRESS}`,
      `${commit}:values.yaml: names host ${APP_STAGED}`,
      `${commit}:values.yaml: names host ${SERVICE}`,
      `${commit}:values.yaml: names host ${NODE_ADDRESS}`,
    ]);
  });

  it("fails shared, link-local, unique local and Tailscale addresses", () => {
    const directory = repository("networks", [
      {
        files: {
          "hosts.txt": [
            `http://${SHARED_ADDRESS}:8080`,
            `http://${METADATA_ADDRESS}/latest`,
            `http://${UNIQUE_LOCAL}:8080`,
            `https://${TAILNET}`,
          ].join("\n"),
        },
        message: "chore: add the hosts",
      },
    ]);
    const result = check(directory);
    assert.equal(result.status, 1);
    assert.deepEqual(result.stderr.trim().split("\n").slice(0, 4), [
      `hosts.txt:1: names host ${SHARED_ADDRESS}`,
      `hosts.txt:2: names host ${METADATA_ADDRESS}`,
      `hosts.txt:3: names host ${UNIQUE_LOCAL}`,
      `hosts.txt:4: names host ${TAILNET}`,
    ]);
  });

  it("fails a host that only a merge resolution added", () => {
    const directory = repository("merge", [
      { files: { "a.txt": "a\n" }, message: "chore: base" },
    ]);
    git(directory, ["checkout", "--quiet", "-b", "side"]);
    writeFileSync(path.join(directory, "b.txt"), "b\n");
    git(directory, ["add", "--all"]);
    git(directory, ["commit", "--quiet", "--message", "chore: side"]);
    git(directory, ["checkout", "--quiet", "main"]);
    writeFileSync(path.join(directory, "c.txt"), "c\n");
    git(directory, ["add", "--all"]);
    git(directory, ["commit", "--quiet", "--message", "chore: main"]);
    git(directory, ["merge", "--quiet", "--no-ff", "--no-commit", "side"]);
    writeFileSync(
      path.join(directory, "evil.txt"),
      `url: https://${UNLISTED}\n`,
    );
    git(directory, ["add", "--all"]);
    git(directory, ["commit", "--quiet", "--message", "Merge side"]);
    const merge = commitOf(directory, "HEAD");
    git(directory, ["rm", "--quiet", "evil.txt"]);
    git(directory, ["commit", "--quiet", "--message", "chore: drop"]);
    const result = check(directory);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `${merge}:evil.txt: names host ${UNLISTED}`,
    );
  });

  it("reads the history of a file that a -diff attribute hides", () => {
    const directory = repository("attributes", [
      {
        files: {
          ".gitattributes": "pnpm-lock.yaml -diff\n",
          "pnpm-lock.yaml": `tarball: https://${REGISTRY}/x/-/x-1.0.0.tgz\n`,
        },
        message: "build: lock",
      },
      {
        files: { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
        message: "build: relock",
      },
    ]);
    const result = check(directory);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `${commitOf(directory, "HEAD~1")}:pnpm-lock.yaml: names host ${REGISTRY}`,
    );
  });

  it("fails a host a past commit added, though the tree no longer names it", () => {
    const directory = repository("history", [
      {
        files: { ".npmrc": `registry=https://${REGISTRY}/\n` },
        message: "build: use the registry",
      },
      {
        files: { ".npmrc": "registry=https://registry.npmjs.org/\n" },
        message: "build: use the public registry",
      },
    ]);
    const result = check(directory);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `${commitOf(directory, "HEAD~1")}:.npmrc: names host ${REGISTRY}`,
    );
  });

  it("fails a commit message that names a private host", () => {
    const directory = repository("message", [
      {
        files: { "README.md": "# Client\n" },
        message: `docs: tested against ${UNLISTED}`,
      },
    ]);
    const result = check(directory);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `${commitOf(directory, "HEAD")} message: names host ${UNLISTED}`,
    );
  });

  it("refuses a shallow clone, whose missing commits it cannot read", () => {
    const source = repository("deep", [
      { files: { "a.txt": "a\n" }, message: "chore: first" },
      { files: { "b.txt": "b\n" }, message: "chore: second" },
    ]);
    git(root, [
      "clone",
      "--quiet",
      "--depth=1",
      pathToFileURL(source).href,
      "shallow",
    ]);
    const result = check(path.join(root, "shallow"));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /history is shallow/);
  });
});
