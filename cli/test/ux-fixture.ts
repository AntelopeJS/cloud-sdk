import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach } from "node:test";
import { createCloudCommand } from "../src/command.js";
import { writeCredentials, writeProjectConfig } from "../src/config.js";
import { describeFailure } from "../src/error-messages.js";
import { isString } from "../src/guards.js";
import type { Runtime } from "../src/types.js";
import { type JsonValue, parseJson, textAt } from "./json.js";
import { type Answers, type Captured, testRuntime } from "./runtime.js";
import { serverPort } from "./server.js";
import { receiveTestSource } from "./source-upload.js";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

interface Fixture {
  runtime: Runtime;
  root: string;
  /** Both streams, line by line. */
  output: string[];
  streams: Captured;
  answers: Answers;
  clock: Clock;
}

interface FixtureOptions {
  isLinked?: boolean;
  isLoggedIn?: boolean;
}

interface Clock {
  now: number;
}

interface BinaryRun {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exit: Promise<number | null>;
}

export const CONSOLE = "https://console.example.test";
export const PROJECT_PATH = "/api/cloud/projects/project-1";
export const PROVISIONING_PATH = "/api/cloud/workspace-provisioning";
export const PROGRESS_PATH = "/api/cloud/deployments/deployment-1/progress";
export const HISTORY_PATH = "/api/cloud/services/service-web/deployments";
export const CONTROL_CODES = ["\r", "\u001b"];

export let origin = "";
export let requests: string[] = [];
export let routes: Record<string, Handler> = {};
const server = createServer((request, response) => {
  const path = request.url ?? "";
  requests.push(`${request.method} ${path}`);
  const handler = handlerFor(`${request.method} ${path}`) ?? handlerFor(path);
  if (handler) return void handler(request, response);
  json(response, 404, { error: "not_found" });
});

function handlerFor(route: string): Handler | undefined {
  return Object.hasOwn(routes, route) ? routes[route] : undefined;
}

export function json(
  response: ServerResponse,
  status: number,
  body: JsonValue,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function reply(status: number, body: JsonValue): Handler {
  return (_, response) => json(response, status, body);
}

export function sse(frames: string, keepOpen = false): Handler {
  return (_, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(frames);
    if (!keepOpen) response.end();
  };
}

export function frame(event: string, data: JsonValue): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const DEVICE_AUTHORIZATION = {
  device_code: "device-code-that-is-long-enough-for-the-contract-123456",
  user_code: "BCDF-2345",
  verification_uri: `${CONSOLE}/cloud/device`,
  verification_uri_complete: `${CONSOLE}/cloud/device?code=BCDF-2345`,
  expires_in: 60,
  interval: 1,
};

export function provisioning(phase: string, reasonCode: string | null = null) {
  return { phase, owner: null, reasonCode, retryAt: null, canRetry: false };
}

export function project(host: string | null = "web.example.test") {
  return {
    id: "project-1",
    slug: "demo",
    region: "eu-central",
    environments: [
      {
        id: "environment-1",
        name: "production",
        services: [
          {
            id: "service-web",
            name: "web",
            status: "unknown",
            primaryHost: host,
            deployment: null,
          },
        ],
      },
    ],
  };
}

export const SUCCEEDING_PROGRESS = [
  frame("state", { deploymentId: "deployment-1", status: "queued" }),
  frame("queue-position", { buildId: "b", serviceId: "s", position: 2 }),
  frame("status-changed", { status: "building" }),
  frame("build-progress", { phase: "running", step: "npm ci" }),
  frame("status-changed", { status: "checking" }),
  frame("status-changed", { status: "succeeded" }),
].join("");

function upload(): Handler {
  return async (request, response) => {
    await receiveTestSource(request);
    json(response, 202, {
      deploymentId: "deployment-1",
      buildId: "build-1",
      status: "queued",
    });
  };
}

/** An upload the API reads, then refuses with the body it answers. */
export function refusedUpload(status: number, body: JsonValue): Handler {
  return async (request, response) => {
    await receiveTestSource(request);
    if (!isString(body)) return json(response, status, body);
    response.writeHead(status, { "content-type": "text/plain" });
    response.end(body);
  };
}

function defaultRoutes() {
  return {
    [PROVISIONING_PATH]: reply(200, provisioning("ready")),
    [PROJECT_PATH]: reply(200, project()),
    [HISTORY_PATH]: reply(200, { revisions: [], desiredRevisionId: null }),
    "/api/cloud/services/service-web/source-deployments": upload(),
    [PROGRESS_PATH]: sse(SUCCEEDING_PROGRESS),
  };
}

function credentials() {
  return {
    apiUrl: origin,
    consoleUrl: CONSOLE,
    token: "secret-token",
    workspace: "workspace-1",
  };
}

export async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "cloud-ux-"));
  const configHome = join(root, "config");
  await writeFile(join(root, "server.js"), "console.log('web')\n");
  await writeFile(join(root, "Dockerfile"), "FROM node:22\nEXPOSE 3000\n");
  if (options.isLoggedIn !== false)
    await writeCredentials(configHome, credentials());
  if (options.isLinked !== false)
    await writeProjectConfig(root, {
      workspace: "workspace-1",
      project: "project-1",
      services: { web: { path: "." } },
    });
  const clock: Clock = { now: 1_000_000 };
  const { runtime, output, answers } = testRuntime(root, configHome);
  runtime.sleep = async (milliseconds) => {
    clock.now += milliseconds;
  };
  runtime.now = () => clock.now;
  return {
    runtime,
    root,
    output: output.lines,
    streams: output,
    answers,
    clock,
  };
}

/** A runtime for progress alone, on its own clock. */
export function progressRuntime(clock: Clock) {
  const { runtime, output } = testRuntime(tmpdir(), tmpdir());
  runtime.now = () => clock.now;
  return { runtime, output: output.lines };
}

export function told(cause: unknown, lang = "en"): string {
  return JSON.stringify(describeFailure(cause, lang));
}

export async function run(runtime: Runtime, args: string[]): Promise<void> {
  await createCloudCommand(runtime)
    .exitOverride()
    .parseAsync(["node", "cloud", ...args]);
}

export function types(output: string[]): string[] {
  return output.map((line) => textAt(parseJson(line), "type"));
}

export function startBinary(
  args: string[],
  cwd: string,
  configHome: string,
): BinaryRun {
  const child = spawn(
    process.execPath,
    [join(process.cwd(), "dist", "bin.js"), ...args],
    {
      cwd,
      env: { PATH: process.env.PATH, XDG_CONFIG_HOME: configHome, LANG: "en" },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exit = new Promise<number | null>((resolve) =>
    child.on("close", (code) => resolve(code)),
  );
  return { child, stdout: () => stdout, stderr: () => stderr, exit };
}

export async function runBinary(args: string[], current?: Fixture) {
  const cwd = current?.root ?? process.cwd();
  const configHome =
    current?.runtime.configHome ?? join(tmpdir(), "cloud-ux-none");
  const binary = startBinary(args, cwd, configHome);
  const status = await binary.exit;
  return { status, stdout: binary.stdout(), stderr: binary.stderr() };
}

export async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(check(), "condition never met");
}

export function rollingOutRevision(state: string) {
  return {
    id: "revision-1",
    number: 1,
    isDesired: true,
    canRollback: false,
    state,
    deploymentId: "deployment-1",
  };
}

/** Starts the mock API before the file's tests and stops it after them. */
export function serveMockApi(): void {
  before(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${serverPort(server)}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requests = [];
    routes = defaultRoutes();
  });
}
