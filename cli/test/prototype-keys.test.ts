import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CloudApiError } from "@antelopejs/cloud-sdk";
import { describeApiError } from "../src/error-messages.js";
import { CliError } from "../src/errors.js";
import { DeployProgress } from "../src/progress.js";
import {
  selectedServiceNames,
  withServiceDockerfiles,
} from "../src/project.js";
import {
  HISTORY_PATH,
  fixture,
  frame,
  progressRuntime,
  project,
  reply,
  routes,
  run,
  serveMockApi,
  sse,
} from "./ux-fixture.js";

serveMockApi();

const PROTOTYPE_KEYS = ["constructor", "toString", "__proto__"];
const LOGS_PATH = "/api/cloud/services/service-web/logs";
const LOG_FRAME = frame("log", {
  at: "2026-09-29T10:00:00Z",
  level: "info",
  message: "ready",
  instance: null,
});

describe("prototype keys read as unknown values, never as table entries", () => {
  for (const key of PROTOTYPE_KEYS) {
    test(`an API refusal coded ${key} is told like any unmapped code`, () => {
      const told = describeApiError(new CloudApiError(500, key), "en");
      const unmapped = describeApiError(
        new CloudApiError(500, "cloud.errors.something_new"),
        "en",
      );
      assert.equal(told.title, unmapped.title);
      assert.equal(told.reason, unmapped.reason);
      assert.deepEqual(told.fixes, unmapped.fixes);
    });

    test(`a Dockerfile for a service named ${key} is refused`, () => {
      assert.throws(
        () =>
          withServiceDockerfiles({ api: { path: "." } }, [`${key}=Dockerfile`]),
        (error) =>
          error instanceof CliError &&
          error.code === "invalid_service_dockerfile",
      );
    });

    test(`a requested service named ${key} is unknown`, () => {
      assert.throws(
        () =>
          selectedServiceNames(
            {
              workspace: "workspace",
              project: "project",
              services: { api: { path: "." } },
            },
            "/repo",
            "/repo",
            key,
          ),
        (error) =>
          error instanceof CliError && error.code === "unknown_service",
      );
    });

    test(`a progress phase named ${key} is shown as it is`, () => {
      const { runtime, output } = progressRuntime({ now: 0 });
      const progress = new DeployProgress(runtime, {}, "web", 0);
      progress.update({ event: "status-changed", data: { status: key } });
      assert.deepEqual(output, [`ℹ web: ${key} · 0s`]);
    });

    test(`a service status ${key} is shown as it is`, async () => {
      const current = await fixture();
      const service = {
        ...project().environments[0]?.services[0],
        status: key,
      };
      routes["/api/cloud/projects/project-1"] = reply(200, {
        ...project(),
        environments: [
          { id: "environment-1", name: "production", services: [service] },
        ],
      });
      await run(current.runtime, ["status"]);
      assert.deepEqual(current.output, [
        `web\t${key}\thttps://web.example.test`,
      ]);
    });

    test(`a deployment in flight with status ${key} is shown as it is`, async () => {
      const current = await fixture();
      routes[HISTORY_PATH] = reply(200, {
        revisions: [],
        desiredRevisionId: null,
        activeBuilds: [
          {
            id: "build-1",
            deploymentId: "deployment-1",
            status: key,
            queuePosition: 2,
            createdAt: "2026-09-29T10:00:00Z",
          },
        ],
      });
      await run(current.runtime, ["status"]);
      assert.deepEqual(current.output, [
        `web\tdeploying (${key}, position in queue: 2)\thttps://web.example.test`,
      ]);
    });

    test(`a log event named ${key} does not end the stream`, async () => {
      const current = await fixture();
      routes[LOGS_PATH] = sse(
        `${frame(key, {})}id: c1\n${LOG_FRAME}${frame("end", {})}`,
      );
      await run(current.runtime, ["logs", "web"]);
      assert.deepEqual(current.output, ["2026-09-29T10:00:00Z info ready"]);
    });
  }
});
