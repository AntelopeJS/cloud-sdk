import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { after, before, beforeEach } from "node:test";
import { createCloudCommand } from "../src/command.js";
import { writeCredentials } from "../src/config.js";
import { describeFailure } from "../src/error-messages.js";
import type { Runtime } from "../src/types.js";
import { type JsonValue, parseJson, textAt } from "./json.js";
import { testRuntime } from "./runtime.js";
import { serverPort } from "./server.js";
import { receiveTestSource } from "./source-upload.js";

interface ApiReply {
  status: number;
  body: JsonValue;
}

type ServiceRow = {
  id: string;
  name: string;
  status: string;
  primaryHost: string | null;
};

type ProjectRow = {
  id: string;
  slug: string;
  status: string;
};

interface MockApi {
  requests: string[];
  bodies: Record<string, JsonValue[]>;
  projects: ProjectRow[];
  services: ServiceRow[];
  canCreateProjects: boolean;
  projectReplies: ApiReply[];
  serviceReplies: ApiReply[];
  archive: Buffer | null;
}

interface Scripted {
  runtime: Runtime;
  root: string;
  output: string[];
  prompts: string[];
  confirms: string[];
}

interface Answers {
  prompts?: string[];
  confirms?: boolean[];
}

export const PROJECTS_PATH = "/api/cloud/projects/";
export const SERVICES_PATH =
  "/api/cloud/projects/project-new/environments/environment-new/services";
export const EXISTING_SERVICES_PATH =
  "/api/cloud/projects/project-demo/environments/environment-demo/services";

export let api: MockApi;
let origin = "";
const server = createServer((request, response) => {
  void handle(request, response);
});

function freshApi(): MockApi {
  return {
    requests: [],
    bodies: {},
    projects: [{ id: "project-demo", slug: "demo", status: "online" }],
    services: [],
    canCreateProjects: true,
    projectReplies: [],
    serviceReplies: [],
    archive: null,
  };
}

function json(response: ServerResponse, reply: ApiReply): void {
  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply.body));
}

async function readBody(request: IncomingMessage): Promise<JsonValue> {
  return parseJson((await buffer(request)).toString("utf8"));
}

function lastBody(path: string): JsonValue {
  const body = api.bodies[path]?.at(-1);
  if (body === undefined) throw new Error(`nothing was posted to ${path}`);
  return body;
}

async function record(request: IncomingMessage, path: string): Promise<void> {
  const body = await readBody(request);
  api.bodies[path] = [...(api.bodies[path] ?? []), body];
}

function project(id: string, slug: string, environmentId: string) {
  return {
    id,
    slug,
    region: "eu-central",
    environments: [
      { id: environmentId, name: "production", services: api.services },
    ],
  };
}

function createdProject(): ApiReply {
  return {
    status: 200,
    body: {
      projectId: "project-new",
      slug: textAt(lastBody(PROJECTS_PATH), "slug"),
      region: "eu-central",
      environmentId: "environment-new",
      serviceId: null,
    },
  };
}

function createdService(path: string): ApiReply {
  const body = lastBody(path);
  const name = textAt(body, "name");
  api.services.push({
    id: "service-new",
    name,
    status: "idle",
    primaryHost: null,
  });
  return {
    status: 200,
    body: {
      serviceId: "service-new",
      name,
      appName: textAt(body, "appName"),
    },
  };
}

function settings(): ApiReply {
  return {
    status: 200,
    body: {
      serviceId: "service-new",
      scaling: {
        bounds: { replicas: { min: 1, max: 2 }, cpu: 1, memory: 1 },
        replicaLimit: 10,
        pricing: {
          currency: "EUR",
          cpuHourUnitPrice: 0.01,
          memoryHourUnitPrice: 0.005,
          volumeGbMonthUnitPrice: 0.1,
          hoursPerMonth: 730,
        },
      },
    },
  };
}

async function upload(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  api.archive = await receiveTestSource(request);
  json(response, {
    status: 202,
    body: {
      deploymentId: "deployment-1",
      buildId: "build-1",
      status: "queued",
    },
  });
}

function progress(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    'event: state\ndata: {"status":"building"}\n\nevent: status-changed\ndata: {"status":"succeeded"}\n\n',
  );
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = request.url ?? "";
  const route = `${request.method} ${path}`;
  api.requests.push(route);
  if (route === `GET ${PROJECTS_PATH}`)
    return json(response, { status: 200, body: { projects: api.projects } });
  if (route === "GET /api/cloud/workspace-provisioning")
    return json(response, {
      status: 200,
      body: {
        phase: "ready",
        owner: null,
        reasonCode: null,
        retryAt: null,
        canRetry: false,
      },
    });
  if (route === "GET /api/cloud/onboarding/")
    return json(response, {
      status: 200,
      body: {
        canCreateProjects: api.canCreateProjects,
        regions: ["eu-central"],
        defaultRegion: "eu-central",
      },
    });
  if (route === `POST ${PROJECTS_PATH}`) {
    await record(request, path);
    return json(response, api.projectReplies.shift() ?? createdProject());
  }
  if (
    route === `POST ${SERVICES_PATH}` ||
    route === `POST ${EXISTING_SERVICES_PATH}`
  ) {
    await record(request, path);
    return json(response, api.serviceReplies.shift() ?? createdService(path));
  }
  if (path === "/api/cloud/projects/project-new")
    return json(response, {
      status: 200,
      body: project("project-new", "fresh", "environment-new"),
    });
  if (path === "/api/cloud/projects/project-demo")
    return json(response, {
      status: 200,
      body: project("project-demo", "demo", "environment-demo"),
    });
  if (path.endsWith("/settings")) return json(response, settings());
  if (path.endsWith("/source-deployments")) return upload(request, response);
  if (path === "/api/cloud/deployments/deployment-1/progress")
    return progress(response);
  return json(response, { status: 404, body: { error: "not_found" } });
}

export async function scripted(
  folder: string,
  answers: Answers = {},
): Promise<Scripted> {
  const base = await mkdtemp(join(tmpdir(), "cloud-first-"));
  const root = join(base, folder);
  const configHome = join(base, "config");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "server.js"),
    "require('http').createServer().listen(8080)\n",
  );
  await writeFile(join(root, "Dockerfile"), "FROM node:22\nEXPOSE 8080\n");
  await writeCredentials(configHome, {
    apiUrl: origin,
    consoleUrl: origin,
    token: "secret-token",
    workspace: "workspace-1",
  });
  const { runtime, output, answers: fake } = testRuntime(root, configHome);
  fake.texts.push(...(answers.prompts ?? []));
  fake.confirms.push(...(answers.confirms ?? []));
  return {
    runtime,
    root,
    output: output.lines,
    prompts: fake.prompts,
    confirms: fake.confirmed,
  };
}

/** The whole problem a failure is told with, as one text to match. */
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

export function posted(path: string): JsonValue[] {
  return api.bodies[path] ?? [];
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
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  beforeEach(() => {
    api = freshApi();
  });
}
