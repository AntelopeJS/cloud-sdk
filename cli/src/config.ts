import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CliError } from "./errors.js";
import { isRecord, isString } from "./guards.js";
import type { Credentials, ProjectConfig, ServicePath } from "./types.js";

export const PROJECT_CONFIG_PATH = join(".antelope", "cloud.json");
const CREDENTIALS_PATH = join("antelopejs", "cloud.json");
const MISSING_FILE = "ENOENT";

/** A linked service: a `path` text and, if any, a `dockerfile` text. */
function isServicePath(service: unknown): service is ServicePath {
  return (
    isRecord(service) &&
    typeof service.path === "string" &&
    (service.dockerfile === undefined || typeof service.dockerfile === "string")
  );
}

function isProjectConfig(value: unknown): value is ProjectConfig {
  if (!isRecord(value) || typeof value.workspace !== "string") return false;
  if (typeof value.project !== "string" || !isRecord(value.services))
    return false;
  return Object.values(value.services).every(
    (service) => isServicePath(service) && service.path.trim() !== "",
  );
}

/** A saved session: the three values every request needs, and the console it was approved on. */
function isCredentials(value: unknown): value is Credentials {
  return (
    isRecord(value) &&
    isString(value.consoleUrl) &&
    [value.apiUrl, value.token, value.workspace].every(
      (field) => isString(field) && field !== "",
    )
  );
}

export async function readCredentials(
  configHome: string,
): Promise<Credentials> {
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(join(configHome, CREDENTIALS_PATH), "utf8"),
    );
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === MISSING_FILE
      )
    )
      throw error;
  }
  if (!isCredentials(value)) throw new CliError("not_authenticated");
  return value;
}

export async function writeCredentials(
  configHome: string,
  credentials: Credentials,
): Promise<void> {
  const path = join(configHome, CREDENTIALS_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

/** Forgets the saved session; false when there was none. */
export async function deleteCredentials(configHome: string): Promise<boolean> {
  const path = join(configHome, CREDENTIALS_PATH);
  try {
    await readFile(path);
  } catch {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

/** Closest folder holding a project link, or null when none does. */
export async function locateProjectRoot(start: string): Promise<string | null> {
  let current = resolve(start);
  while (true) {
    try {
      await readFile(join(current, PROJECT_CONFIG_PATH));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export async function findProjectRoot(start: string): Promise<string> {
  const root = await locateProjectRoot(start);
  if (root === null) throw new CliError("project_not_linked");
  return root;
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  const value: unknown = JSON.parse(
    await readFile(join(root, PROJECT_CONFIG_PATH), "utf8"),
  );
  if (!isProjectConfig(value)) throw new CliError("invalid_project_config");
  return value;
}

export async function writeProjectConfig(
  root: string,
  config: ProjectConfig,
): Promise<void> {
  const path = join(root, PROJECT_CONFIG_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}
