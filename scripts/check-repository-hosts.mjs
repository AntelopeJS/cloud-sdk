#!/usr/bin/env node
/**
 * Keeps private deployments out of this public repository: fails when a
 * tracked file, a line any commit of `HEAD` added, or a commit message names a
 * host of ours that is not production's, a host that says staging, or a
 * private network's. A host is read after `://`, as a name of ours, or as a
 * private-network address or name written without a scheme (a `.internal`,
 * `.svc`, `.local` or `.lan` name only before a port or a path). Run from the
 * repository root, with the whole history: a shallow clone fails instead of
 * passing on the commits it lacks.
 *
 * Prints failures only. Usage: node scripts/check-repository-hosts.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostsOf, isPrivateHost } from "./hosts.mjs";

const MAX_BUFFER = 1 << 30;

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: MAX_BUFFER });
}

/**
 * One finding per private host a line names.
 * @param {string} where
 * @param {string} line
 * @returns {string[]}
 */
function findingsOf(where, line) {
  return [...hostsOf(line)]
    .filter(isPrivateHost)
    .map((host) => `${where}: names host ${host}`);
}

/** @returns {string[]} */
function trackedFileFindings() {
  return git(["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .flatMap((path) => {
      const text = readFileSync(path, "utf8");
      if (text.includes("\0")) return [];
      return text
        .split("\n")
        .flatMap((line, index) => findingsOf(`${path}:${index + 1}`, line));
    });
}

/** @returns {string[]} */
function commitMessageFindings() {
  const fields = git(["log", "--format=%H%x00%B%x00", "HEAD"]).split("\0");
  /** @type {string[]} */
  const findings = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const where = `${fields[index].trim().slice(0, 12)} message`;
    for (const line of fields[index + 1].split("\n"))
      findings.push(...findingsOf(where, line));
  }
  return findings;
}

/**
 * Every line a commit of `HEAD` added, read from the diff body only: a header
 * runs from `diff --git` to the first hunk. `--text` reads files that a `-diff`
 * attribute or binary content would hide, and a merge shows the lines its
 * resolution added beyond the automatic merge.
 * @returns {string[]}
 */
function addedLineFindings() {
  const log = git([
    "log",
    "-p",
    "--text",
    "--diff-merges=remerge",
    "--no-color",
    "--no-ext-diff",
    "--format=commit %H",
    "HEAD",
  ]);
  /** @type {string[]} */
  const findings = [];
  let commit = "";
  let path = "";
  let header = false;
  for (const line of log.split("\n")) {
    if (line.startsWith("commit ")) commit = line.slice(7, 19);
    else if (line.startsWith("diff --git ")) header = true;
    else if (line.startsWith("@@")) header = false;
    else if (header && line.startsWith("+++ b/")) path = line.slice(6);
    else if (!header && line.startsWith("+"))
      findings.push(...findingsOf(`${commit}:${path}`, line.slice(1)));
  }
  return findings;
}

if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
  console.error("The history is shallow: run git fetch --unshallow first.");
  process.exit(2);
}
const findings = [
  ...trackedFileFindings(),
  ...commitMessageFindings(),
  ...addedLineFindings(),
];
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
