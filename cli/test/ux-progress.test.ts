import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type TaskHandle, TaskList } from "@antelopejs/core/cli";
import { CliError } from "../src/errors.js";
import { DeployProgress, HEARTBEAT_INTERVAL_MS } from "../src/progress.js";
import { jsonAt, parseJson } from "./json.js";
import {
  CONSOLE,
  CONTROL_CODES,
  PROGRESS_PATH,
  SUCCEEDING_PROGRESS,
  fixture,
  frame,
  progressRuntime,
  reply,
  routes,
  run,
  runBinary,
  serveMockApi,
  sse,
  startBinary,
  told,
  waitFor,
} from "./ux-fixture.js";

serveMockApi();

const failsWhenCalled = (): never => {
  throw new Error(
    "the progress used the task in a way the test does not expect",
  );
};

/** A task list that keeps the labels of its task and whether it was dismissed. */
class RecordedTasks extends TaskList {
  readonly labels: string[] = [];
  isDismissed = false;

  override start(label: string): TaskHandle {
    this.labels.push(label);
    return {
      update: (next) => {
        this.labels.push(next);
      },
      dismiss: () => {
        this.isDismissed = true;
      },
      succeed: failsWhenCalled,
      warn: failsWhenCalled,
      skip: failsWhenCalled,
      fail: failsWhenCalled,
    };
  }
}

describe("C5: deploy progress", () => {
  test("names each phase with the elapsed time, then the URL and total time", async () => {
    const current = await fixture();
    await run(current.runtime, ["deploy"]);
    assert.deepEqual(current.streams.stderr, [
      "ℹ web: uploading · 0s",
      "ℹ web: queued · 0s",
      "ℹ web: queued (position in queue: 2) · 0s",
      "ℹ web: building · 0s",
      "ℹ web: building (npm ci) · 0s",
      "ℹ web: rolling out · 0s",
      "ℹ web: live · 0s",
      "Deployed web · 0ms",
      "Next steps",
      "  ajs-cloud status       check where it is",
      "  ajs-cloud logs web -f  read the service logs",
    ]);
    assert.deepEqual(current.streams.stdout, ["https://web.example.test"]);
  });

  test("keeps the JSON Lines events and adds the URL and duration", async () => {
    const current = await fixture();
    await run(current.runtime, ["--json", "deploy"]);
    const lines = current.output.map((line) => parseJson(line));
    assert.deepEqual(
      lines.map((line) => jsonAt(line, "type")),
      `deploy_started ${"deploy_event ".repeat(6)}deploy_succeeded`.split(" "),
    );
    assert.deepEqual(jsonAt(lines[lines.length - 1], "data"), {
      services: ["web"],
      urls: { web: "https://web.example.test" },
      durationMs: 0,
    });
  });

  test("says a quiet phase is still running, without a terminal", () => {
    const clock = { now: 0 };
    const { runtime, output } = progressRuntime(clock);
    const progress = new DeployProgress(runtime, {}, "web", 0);
    progress.update({ event: "status-changed", data: { status: "building" } });
    clock.now = HEARTBEAT_INTERVAL_MS - 1;
    progress.tick();
    clock.now = 65_000;
    progress.tick();
    assert.deepEqual(output, [
      "ℹ web: building · 0s",
      "ℹ web: still building · 1m 05s",
    ]);
  });

  test("N2: a finished build reads as rolling out until the deployment is live", () => {
    const clock = { now: 0 };
    const { runtime, output } = progressRuntime(clock);
    const progress = new DeployProgress(runtime, {}, "web", 0);
    progress.update({ event: "status-changed", data: { status: "building" } });
    clock.now = 48_000;
    progress.update({ event: "build-progress", data: { phase: "succeeded" } });
    clock.now = 90_000;
    progress.tick();
    progress.update({ event: "status-changed", data: { status: "checking" } });
    clock.now = 410_000;
    progress.update({ event: "status-changed", data: { status: "succeeded" } });
    assert.deepEqual(output, [
      "ℹ web: building · 0s",
      "ℹ web: rolling out · 48s",
      "ℹ web: still rolling out · 1m 30s",
      "ℹ web: live · 6m 50s",
    ]);
  });

  test("N2: a build that ends after the checking status keeps rolling out", async () => {
    const current = await fixture();
    routes[PROGRESS_PATH] = sse(
      [
        frame("status-changed", { status: "building" }),
        frame("status-changed", { status: "checking" }),
        frame("build-progress", { phase: "succeeded" }),
        frame("status-changed", { status: "succeeded" }),
      ].join(""),
    );
    await run(current.runtime, ["deploy"]);
    assert.deepEqual(current.streams.stderr.slice(0, 5), [
      "ℹ web: uploading · 0s",
      "ℹ web: queued · 0s",
      "ℹ web: building · 0s",
      "ℹ web: rolling out · 0s",
      "ℹ web: live · 0s",
    ]);
  });

  test("N2: a failed build waits for the status that ends the deployment", () => {
    const { runtime, output } = progressRuntime({ now: 0 });
    const progress = new DeployProgress(runtime, {}, "web", 0);
    progress.update({ event: "status-changed", data: { status: "building" } });
    progress.update({ event: "build-progress", data: { phase: "failed" } });
    progress.update({ event: "status-changed", data: { status: "failed" } });
    assert.deepEqual(output, ["ℹ web: building · 0s", "ℹ web: failed · 0s"]);
  });

  test("keeps its task up to date on a terminal, then removes it", () => {
    const { runtime, output } = progressRuntime({ now: 5_000 });
    const tasks = new RecordedTasks();
    runtime.hasLiveProgress = true;
    runtime.tasks = tasks;
    const progress = new DeployProgress(runtime, {}, "web", 0);
    progress.start();
    progress.tick();
    progress.stop();
    assert.equal(tasks.labels.at(-1), "web: uploading · 5s");
    assert.ok(tasks.isDismissed);
    assert.deepEqual(output, ["ℹ web: uploading · 5s"]);
  });

  test("human output without a TTY carries no control codes", async () => {
    const current = await fixture();
    const result = await runBinary(["deploy"], current);
    assert.equal(result.status, 0, result.stderr);
    for (const code of CONTROL_CODES) {
      assert.equal(result.stdout.includes(code), false);
      assert.equal(result.stderr.includes(code), false);
    }
    assert.match(result.stderr, /web: building/);
    assert.match(result.stderr, /Deployed web/);
    assert.equal(result.stdout, "https://web.example.test\n");
  });

  test("stops waiting after --timeout and says the deployment continues", async () => {
    const current = await fixture();
    routes[PROGRESS_PATH] = sse(frame("state", { status: "queued" }), true);
    await assert.rejects(
      run(current.runtime, ["deploy", "--timeout", "0.001"]),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, "deployment_timeout");
        assert.match(
          told(error),
          /still running on the platform.*ajs-cloud status/,
        );
        assert.deepEqual(error.details, [
          "web: still queued · 0s",
          `${CONSOLE}/projects/project/deployment?project=project-1&service=service-web&deployment=deployment-1`,
        ]);
        return true;
      },
    );
  });

  test("Ctrl+C says the deployment keeps running and how to follow it", async () => {
    const current = await fixture();
    routes[PROGRESS_PATH] = sse(frame("state", { status: "queued" }), true);
    const binary = startBinary(
      ["deploy"],
      current.root,
      current.runtime.configHome,
    );
    await waitFor(() => binary.stderr().includes("web: queued"));
    binary.child.kill("SIGINT");
    assert.equal(await binary.exit, 130);
    assert.match(
      binary.stderr(),
      /Stopped following: the deployment keeps running on the platform/,
    );
    assert.match(binary.stderr(), /ajs-cloud status/);
    assert.match(binary.stderr(), /ajs-cloud logs web -f/);
    assert.match(
      binary.stderr(),
      /deployment\?project=project-1&service=service-web&deployment=deployment-1/,
    );
  });

  test("a failed deployment gives its reason and console page", async () => {
    const current = await fixture();
    routes[PROGRESS_PATH] = sse(frame("status-changed", { status: "failed" }));
    routes["/api/cloud/deployments/deployment-1"] = reply(200, {
      id: "deployment-1",
      status: "failed",
      failure: { key: "cloud.errors.builds.submit_rejected", params: {} },
    });
    await assert.rejects(
      run(current.runtime, ["deploy"]),
      (error: CliError) => {
        assert.equal(error.code, "deployment_failed");
        assert.match(told(error), /ajs-cloud logs web/);
        assert.equal(
          error.details[0],
          "Reason: cloud.errors.builds.submit_rejected",
        );
        return true;
      },
    );
  });

  test("a failed build gives why it failed, and a retry hint when the platform did", async () => {
    const current = await fixture();
    routes[PROGRESS_PATH] = sse(frame("status-changed", { status: "failed" }));
    routes["/api/cloud/deployments/deployment-1"] = reply(200, {
      id: "deployment-1",
      status: "failed",
      failure: null,
      builds: [
        { id: "build-0", status: "succeeded", failureReason: null },
        {
          id: "build-1",
          status: "failed",
          failureReason: {
            code: "disk_full",
            platform: true,
            summary: "no space left on device",
            step: null,
          },
        },
      ],
    });
    await assert.rejects(
      run(current.runtime, ["deploy"]),
      (error: CliError) => {
        assert.equal(
          error.details[0],
          "Reason: no space left on device (a platform error, not your code: deploy again)",
        );
        return true;
      },
    );
  });

  test("a failed build of the source's own gives its reason without a retry hint", async () => {
    const current = await fixture();
    routes[PROGRESS_PATH] = sse(frame("status-changed", { status: "failed" }));
    routes["/api/cloud/deployments/deployment-1"] = reply(200, {
      id: "deployment-1",
      status: "failed",
      failure: null,
      builds: [
        {
          id: "build-1",
          status: "failed",
          failureReason: {
            code: "dockerfile_step",
            platform: false,
            summary: "exit code: 3",
            step: 3,
          },
        },
      ],
    });
    await assert.rejects(
      run(current.runtime, ["deploy"]),
      (error: CliError) => {
        assert.equal(error.details[0], "Reason: exit code: 3");
        return true;
      },
    );
  });

  test("reopens a progress stream that closed before the end", async () => {
    const current = await fixture();
    let opened = 0;
    routes[PROGRESS_PATH] = (request, response) => {
      opened += 1;
      const frames =
        opened === 1
          ? frame("state", { status: "queued" })
          : SUCCEEDING_PROGRESS;
      return sse(frames)(request, response);
    };
    await run(current.runtime, ["--json", "deploy"]);
    assert.equal(opened, 2);
  });
});
