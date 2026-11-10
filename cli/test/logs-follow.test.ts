import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, mock, test } from "node:test";
import { CloudApiError } from "@antelopejs/cloud-sdk";
import {
  fixture,
  frame,
  json,
  routes,
  run,
  serveMockApi,
} from "./ux-fixture.js";

serveMockApi();

const FOLLOW_PATH = "/api/cloud/services/service-web/logs?follow=true";
const TOO_MANY_FOLLOWS = { error: "cloud.errors.logs.too_many_follows" };

type Answer = (response: ServerResponse) => void;

/** A log line frame carrying its cursor, as the API sends it. */
function line(id: string, message: string): string {
  return `id: ${id}\n${frame("log", { at: "2026-11-02T10:00:00Z", level: "info", message, instance: null })}`;
}

/** Live follows the API answers in turn, recording what each request resumed from. */
function followAnswers(answers: Answer[]): Array<string | undefined> {
  const resumedFrom: Array<string | undefined> = [];
  routes[FOLLOW_PATH] = (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    const header = request.headers["last-event-id"];
    resumedFrom.push(Array.isArray(header) ? header[0] : header);
    const answer = answers.shift();
    if (!answer) return json(response, 500, { error: "unexpected_request" });
    answer(response);
  };
  return resumedFrom;
}

function stream(frames: string): Answer {
  return (response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(frames);
  };
}

function refused(response: ServerResponse): void {
  json(response, 429, TOO_MANY_FOLLOWS);
}

describe("logs -f when the live-stream limit refuses it", () => {
  test("waits out a 429 refusing the reconnect of a live follow, backing off from one second", async () => {
    mock.method(Math, "random", () => 0.5);
    const current = await fixture();
    const sleeps: number[] = [];
    current.runtime.sleep = async (milliseconds) => {
      sleeps.push(milliseconds);
      current.clock.now += milliseconds;
    };
    const resumedFrom = followAnswers([
      stream(line("c1", "before the roll")),
      refused,
      refused,
      stream(`${line("c2", "after the roll")}${frame("end", {})}`),
    ]);

    try {
      await run(current.runtime, ["logs", "web", "-f"]);
    } finally {
      mock.restoreAll();
    }

    assert.deepEqual(resumedFrom, [undefined, "c1", "c1", "c1"]);
    assert.deepEqual(current.output, [
      "2026-11-02T10:00:00Z info before the roll",
      "2026-11-02T10:00:00Z info after the roll",
    ]);
    assert.deepEqual(
      sleeps.slice(-2),
      [750, 1_500],
      "a 1 s then 2 s backoff, each wait at the middle of its second half",
    );
  });

  test("stops at a 429 refusing a follow that never opened", async () => {
    const current = await fixture();
    const resumedFrom = followAnswers([refused, refused]);

    await assert.rejects(
      run(current.runtime, ["logs", "web", "-f"]),
      (error) => error instanceof CloudApiError && error.status === 429,
    );

    assert.equal(resumedFrom.length, 1);
  });
});
