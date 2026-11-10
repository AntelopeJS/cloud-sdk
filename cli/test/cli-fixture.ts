import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { after, before } from "node:test";
import { extract } from "tar-stream";
import { createCloudCommand } from "../src/command.js";
import { writeCredentials, writeProjectConfig } from "../src/config.js";
import { CliError } from "../src/errors.js";
import type { ProjectConfig, Runtime } from "../src/types.js";
import { type JsonValue } from "./json.js";
import { testRuntime } from "./runtime.js";
import { serverPort } from "./server.js";
import { receiveTestSource } from "./source-upload.js";

interface MockState {
  requests: string[];
  archive: Buffer | null;
  lastEventId: string | null;
  reconnectLogs: boolean;
  logRequests: number;
  tokenPolls: number;
  /** Services the project keeps; every fixture service when null. */
  serviceNames: string[] | null;
  /** The services each one links to, by id. */
  links: Record<string, string[]>;
}

interface BinaryResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

export const state: MockState = {
  requests: [],
  archive: null,
  lastEventId: null,
  reconnectLogs: false,
  logRequests: 0,
  tokenPolls: 0,
  serviceNames: null,
  links: {},
};
export let origin = "";
const server = createServer(handleRequest);
export let otherOrigin = "";
export const otherRequests: string[] = [];
const otherServer = createServer((request, response) => {
  otherRequests.push(`${request.method} ${request.url}`);
  json(response, 500, { error: "unexpected_endpoint" });
});

function json(response: ServerResponse, status: number, body: JsonValue): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function sourceDeployment(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    assert.equal(request.headers.authorization, "Bearer secret-token");
    state.archive = await receiveTestSource(request);
    json(response, 202, {
      deploymentId: "deployment-1",
      buildId: "build-1",
      status: "queued",
    });
  } catch {
    json(response, 400, { error: "cloud.errors.builds.invalid_upload" });
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = request.url ?? "";
  state.requests.push(`${request.method} ${path}`);
  if (path === "/api/cloud/cli/device") return json(response, 200, device());
  if (path === "/api/cloud/cli/token") return token(response);
  if (path === "/api/cloud/projects/")
    return json(response, 200, projectList());
  if (path === "/api/cloud/projects/project-1")
    return json(response, 200, project());
  if (path === "/api/cloud/projects/quota")
    return json(response, 429, { error: "cloud.errors.services.limit" });
  if (path.endsWith("/source-deployments"))
    return sourceDeployment(request, response);
  if (path === "/api/cloud/deployments/deployment-1/progress")
    return sse(response, progressFrames());
  if (path.endsWith("/logs?follow=true")) {
    state.logRequests += 1;
    const lastEventId = request.headers["last-event-id"];
    state.lastEventId = Array.isArray(lastEventId)
      ? (lastEventId[0] ?? null)
      : (lastEventId ?? null);
    if (state.reconnectLogs && state.logRequests === 1)
      return sse(response, logFrames(false));
    return sse(response, logFrames());
  }
  if (path.endsWith("/deployments") && request.method === "GET")
    return json(response, 200, history());
  if (path.endsWith("/rollback"))
    return json(response, 200, { revisionId: "revision-3", status: "changed" });
  return json(response, 404, { error: "not_found" });
}

function token(response: ServerResponse): void {
  state.tokenPolls += 1;
  if (state.tokenPolls === 1) {
    json(response, 428, { error: "authorization_pending" });
    return;
  }
  json(response, 200, {
    access_token: "secret-token",
    token_type: "Bearer",
    workspace_id: "workspace-1",
  });
}

function sse(response: ServerResponse, frames: string): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(frames);
}

function device() {
  return {
    device_code: "device-code-that-is-long-enough-for-the-contract-123456",
    user_code: "BCDF-2345",
    verification_uri: `${origin}/cloud/device`,
    verification_uri_complete: `${origin}/cloud/device?code=BCDF-2345`,
    expires_in: 30,
    interval: 0,
  };
}

function projectList() {
  return { projects: [{ id: "project-1", slug: "demo", status: "online" }] };
}

function project() {
  return {
    id: "project-1",
    slug: "demo",
    region: "eu-west",
    environments: [
      {
        id: "environment-1",
        name: "production",
        services: [
          {
            id: "service-api",
            name: "api",
            status: "online",
            primaryHost: "api.example.test",
            deployment: { number: 3, occurredAt: "2026-09-25T10:00:00.000Z" },
          },
          {
            id: "service-app",
            name: "app",
            status: "deploying",
            primaryHost: null,
            deployment: null,
          },
          {
            id: "service-worker",
            name: "worker",
            status: "unknown",
            primaryHost: null,
            deployment: null,
          },
        ]
          .filter(
            (service) =>
              state.serviceNames === null ||
              state.serviceNames.includes(service.name),
          )
          .map((service) => ({
            ...service,
            linkedServiceIds: state.links[service.id] ?? [],
          })),
      },
    ],
  };
}

function history() {
  return {
    desiredRevisionId: "revision-2",
    revisions: [
      { id: "revision-2", number: 2, isDesired: true, canRollback: false },
      { id: "revision-1", number: 1, isDesired: false, canRollback: true },
    ],
  };
}

export function progressFrames(): string {
  return 'event: state\ndata: {"status":"building"}\n\nevent: status-changed\ndata: {"status":"succeeded"}\n\n';
}

function logFrames(withEnd = true): string {
  const log =
    'id: cursor-1\nevent: log\ndata: {"at":"2026-09-03T00:00:00Z","level":"info","message":"ready","instance":"api-1"}\n\n';
  return withEnd ? `${log}event: end\ndata: {}\n\n` : log;
}

export async function fixture(): Promise<{
  runtime: Runtime;
  root: string;
  output: string[];
}> {
  const root = await mkdtemp(join(tmpdir(), "cloud-cli-"));
  const configHome = join(root, "config");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await mkdir(join(root, "apps", "app"), { recursive: true });
  await writeFile(
    join(root, "apps", "api", "index.js"),
    "console.log('api')\n",
  );
  await writeFile(
    join(root, "apps", "app", "index.js"),
    "console.log('app')\n",
  );
  await writeCredentials(configHome, credentials());
  await writeProjectConfig(root, config());
  const { runtime, output } = testRuntime(root, configHome);
  return { root, output: output.lines, runtime };
}

export function credentials() {
  return {
    apiUrl: origin,
    consoleUrl: origin,
    token: "secret-token",
    workspace: "workspace-1",
  };
}

export function config(): ProjectConfig {
  return {
    workspace: "workspace-1",
    project: "project-1",
    services: { api: { path: "apps/api" }, app: { path: "apps/app" } },
  };
}

export async function run(runtime: Runtime, args: string[]): Promise<void> {
  await createCloudCommand(runtime)
    .exitOverride()
    .parseAsync(["node", "cloud", ...args]);
}

export async function runFailure(
  runtime: Runtime,
  args: string[],
): Promise<CliError> {
  try {
    await run(runtime, args);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("the command did not fail");
}

export function runBinary(
  args: string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<BinaryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "dist", "bin.js"), ...args],
      { cwd, env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr, stdout }));
  });
}

export async function archiveContents(
  archive: Buffer,
): Promise<Record<string, string>> {
  const unpack = extract();
  const contents: Record<string, string> = {};
  unpack.end(archive);
  for await (const entry of unpack) {
    contents[entry.header.name] = (await buffer(entry)).toString("utf8");
  }
  return contents;
}

export async function archiveNames(archive: Buffer): Promise<string[]> {
  const unpack = extract();
  const names: string[] = [];
  unpack.end(archive);
  for await (const entry of unpack) {
    names.push(entry.header.name);
    entry.resume();
  }
  return names;
}

/** Starts the mock API before the file's tests and stops it after them. */
export function serveMockApi(): void {
  before(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${serverPort(server)}`;
    await new Promise<void>((resolve) =>
      otherServer.listen(0, "127.0.0.1", resolve),
    );
    otherOrigin = `http://127.0.0.1:${serverPort(otherServer)}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      otherServer.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
