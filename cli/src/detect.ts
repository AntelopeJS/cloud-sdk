import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isRecord, isString } from "./guards.js";
import { isValidPort, slugify } from "./naming.js";

/** Service name a first deployment proposes when none is given. */
export const DEFAULT_SERVICE_NAME = "web";
/**
 * Port proposed when nothing in the folder names one. The platform passes the
 * service's port to the app as `PORT`, which a Node app without a Dockerfile
 * is expected to listen on.
 */
export const DEFAULT_PORT = 3000;

const DOCKERFILE = "Dockerfile";
const PACKAGE_JSON = "package.json";
const ANTELOPE_CONFIG_PATTERN = /^antelope\.config\.(?:js|mjs|cjs|ts)$/;
const EXPOSE_PATTERN = /^\s*EXPOSE\s+(\d+)/im;
const SCRIPT_PORT_PATTERN = /(?:--port[= ]|\s-p\s+|\bPORT=)(\d+)/;
const PORT_SCRIPTS = ["start", "serve", "preview"];

/**
 * Port a framework serves on by default, for the frameworks whose default is
 * not {@link DEFAULT_PORT}.
 */
const FRAMEWORK_PORTS = {
  astro: 4321,
} as const satisfies Record<string, number>;

interface PackageManifest {
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

/**
 * How the API would build a folder, read from its root: its `Dockerfile`, the
 * one it writes for an AntelopeJS project, or the one it writes for a Node app
 * started by its `start` script.
 */
export type BuildKind = "dockerfile" | "antelope" | "node";

/** What a folder suggests about the project a first deployment creates. */
export interface DetectedApp {
  projectSlug: string;
  /** Null when the folder offers the API nothing to build from. */
  buildKind: BuildKind | null;
  /** Null when nothing in the folder names a port. */
  port: number | null;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function parsedPort(value: string | undefined): number | null {
  const port = Number(value);
  return value && isValidPort(port) ? port : null;
}

async function readManifest(root: string): Promise<PackageManifest | null> {
  const text = await readText(join(root, PACKAGE_JSON));
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function manifestPort(manifest: PackageManifest): number | null {
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  const fromScripts = PORT_SCRIPTS.map((name) => {
    const script = scripts[name];
    return parsedPort(
      isString(script) ? script.match(SCRIPT_PORT_PATTERN)?.[1] : undefined,
    );
  }).find((port) => port !== null);
  if (fromScripts) return fromScripts;
  const dependencies = new Map(
    [manifest.devDependencies, manifest.dependencies].flatMap((group) =>
      isRecord(group) ? Object.entries(group) : [],
    ),
  );
  const framework = Object.entries(FRAMEWORK_PORTS).find(([name]) =>
    dependencies.get(name),
  );
  return framework ? framework[1] : null;
}

/**
 * Port the app listens on, read from what is cheap to trust: a Dockerfile's
 * `EXPOSE` first, since it states what the image serves, then an explicit port
 * in the package scripts, then a known framework default.
 *
 * @param root App folder
 */
export async function detectPort(root: string): Promise<number | null> {
  const dockerfile = await readText(join(root, DOCKERFILE));
  const exposed = parsedPort(dockerfile?.match(EXPOSE_PATTERN)?.[1]);
  if (exposed) return exposed;
  const manifest = await readManifest(root);
  return manifest ? manifestPort(manifest) : null;
}

/**
 * How the API would build the folder. A coarse check only: the API alone
 * decides, and refuses with the reason what this lets through — a
 * `package.json` without a `start` script, a monorepo, an unsupported Node.js.
 *
 * @param entries Names of the files at the folder's root
 */
export function detectBuildKind(entries: readonly string[]): BuildKind | null {
  if (entries.includes(DOCKERFILE)) return "dockerfile";
  if (entries.some((name) => ANTELOPE_CONFIG_PATTERN.test(name)))
    return "antelope";
  return entries.includes(PACKAGE_JSON) ? "node" : null;
}

/**
 * Defaults a first deployment proposes for a folder: the project is named
 * after the folder, the port comes from {@link detectPort}.
 *
 * @param root App folder
 */
export async function detectApp(root: string): Promise<DetectedApp> {
  const absolute = resolve(root);
  const entries = await readdir(absolute);
  return {
    projectSlug: slugify(basename(absolute)),
    buildKind: detectBuildKind(entries),
    port: await detectPort(absolute),
  };
}
