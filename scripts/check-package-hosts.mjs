#!/usr/bin/env node
/**
 * Holds the public npm packages to production: packs each package directory
 * given as an argument, exactly as `npm publish` would, and fails when a file
 * of the tarball names `staging` or a URL whose host is not a production host.
 * Test deployments stay reachable through `--api-url`, `ANTELOPE_CLOUD_URL` or
 * the SDK's `baseUrl`, never through a published default.
 *
 * Prints failures only. Usage: node scripts/check-package-hosts.mjs sdk cli
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { hostsOf, isPublishableHost, STAGING_PATTERN } from "./hosts.mjs";

/**
 * The files of a directory, recursively.
 * @param {string} directory
 * @returns {string[]}
 */
function filesOf(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesOf(path) : [path];
  });
}

/**
 * What one packed file must not say, one line per finding.
 * @param {string} name Path inside the tarball
 * @param {string} text
 * @returns {string[]}
 */
function findingsOf(name, text) {
  /** @type {string[]} */
  const findings = [];
  text.split("\n").forEach((line, index) => {
    const where = `${name}:${index + 1}`;
    if (STAGING_PATTERN.test(line)) findings.push(`${where}: names staging`);
    for (const host of hostsOf(line))
      if (!isPublishableHost(host))
        findings.push(`${where}: names host ${host}`);
  });
  return findings;
}

/**
 * Packs one package directory and lists what its tarball must not say.
 * @param {string} directory
 * @returns {string[]}
 */
function checkPackage(directory) {
  const output = mkdtempSync(join(tmpdir(), "package-hosts-"));
  try {
    execFileSync("npm", ["pack", "--pack-destination", output], {
      cwd: directory,
      stdio: "pipe",
    });
    const tarball = readdirSync(output).find((name) => name.endsWith(".tgz"));
    if (!tarball) throw new Error(`npm pack wrote no tarball for ${directory}`);
    const unpacked = join(output, "unpacked");
    execFileSync("mkdir", [unpacked]);
    execFileSync("tar", ["-xzf", join(output, tarball), "-C", unpacked]);
    return filesOf(unpacked).flatMap((file) =>
      findingsOf(
        `${directory}/${relative(join(unpacked, "package"), file)}`,
        readFileSync(file, "utf8"),
      ),
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

const directories = process.argv.slice(2);
if (directories.length === 0) {
  console.error("usage: check-package-hosts.mjs <package directory>...");
  process.exit(2);
}
const findings = directories.flatMap((directory) =>
  checkPackage(relative(process.cwd(), resolve(directory)) || "."),
);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
