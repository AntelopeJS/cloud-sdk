import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CloudApi, CloudApiError, type SseEvent } from "../src/index.js";

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  accept: string | null;
  lastEventId: string | null;
}

/** A `fetch` that records each request and answers every one with `answer`. */
function recorder(answer: () => Response) {
  const sent: Sent[] = [];
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      accept: request.headers.get("accept"),
      lastEventId: request.headers.get("last-event-id"),
    });
    return answer();
  };
  return { sent, send };
}

function eventStream(frames: readonly string[]): Response {
  return new Response(frames.map((frame) => `${frame}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function eventsOf(stream: AsyncGenerator<SseEvent>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const BUILD = "https://api.antelopejs.cloud/api/cloud/builds/b%2F1/logs";
const RECIPE = {
  at: "2026-01-02T03:04:05.000Z",
  level: "info",
  message: "Build recipe: AntelopeJS",
  instance: null,
};
const FAILURE = {
  at: "2026-01-02T03:05:00.000Z",
  level: "error",
  message: "ERR_PNPM_FETCH_404",
  instance: "build-1",
};

describe("the log of a build", () => {
  test("a bounded read asks the encoded build for its newest lines and yields them in order, then the end", async () => {
    const { sent, send } = recorder(() =>
      eventStream([
        ": open",
        `id: \nevent: log\ndata: ${JSON.stringify(RECIPE)}`,
        `id: c-2\nevent: log\ndata: ${JSON.stringify(FAILURE)}`,
        "event: end\ndata: {}",
      ]),
    );
    const api = new CloudApi({ token: "t-1", fetch: send });

    const events = await eventsOf(
      api.buildLogs("b/1", { follow: false, limit: 200 }),
    );

    assert.deepEqual(sent, [
      {
        url: `${BUILD}?limit=200`,
        method: "GET",
        authorization: "Bearer t-1",
        accept: "text/event-stream",
        lastEventId: null,
      },
    ]);
    assert.deepEqual(events, [
      { event: "log", data: RECIPE, id: "" },
      { event: "log", data: FAILURE, id: "c-2" },
      { event: "end", data: {}, id: undefined },
    ]);
  });

  test("a follow resumes after the last event received, with no limit unless one is given", async () => {
    const { sent, send } = recorder(() => eventStream([]));
    const api = new CloudApi({ token: "t", fetch: send });

    await api.buildLogs("b/1", { follow: true, lastEventId: "c-2" }).next();
    await api.buildLogs("b/1", { follow: true, limit: 50 }).next();
    await api.buildLogs("b/1", { follow: false }).next();

    assert.deepEqual(
      sent.map((request) => `${request.url} ${request.lastEventId}`),
      [
        `${BUILD}?follow=true c-2`,
        `${BUILD}?follow=true&limit=50 null`,
        `${BUILD} null`,
      ],
    );
  });

  test("the caller hears that the read was accepted before its first line", async () => {
    const { send } = recorder(() =>
      eventStream([`id: c-2\nevent: log\ndata: ${JSON.stringify(FAILURE)}`]),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    const order: string[] = [];

    const stream = api.buildLogs("b/1", {
      follow: false,
      onOpen: () => order.push("open"),
    });
    for await (const event of stream) order.push(event.event);

    assert.deepEqual(order, ["open", "log"]);
  });

  test("a build the member cannot read is a CloudApiError carrying the code, and nothing is yielded", async () => {
    const { send } = recorder(
      () =>
        new Response(JSON.stringify("cloud.errors.builds.not_found"), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    const api = new CloudApi({ token: "t", fetch: send });
    let opened = false;

    await assert.rejects(
      api
        .buildLogs("b/1", { follow: false, onOpen: () => (opened = true) })
        .next(),
      (error) => {
        assert.ok(error instanceof CloudApiError);
        assert.equal(error.status, 404);
        assert.equal(error.code, "cloud.errors.builds.not_found");
        return true;
      },
    );
    assert.equal(opened, false);
  });

  test("a service's log read is sent as before: follow only, never a limit", async () => {
    const { sent, send } = recorder(() => eventStream([]));
    const api = new CloudApi({ token: "t", fetch: send });

    await api.logs("s/1", { follow: true, lastEventId: "c-9" }).next();
    await api.logs("s/1", { follow: false }).next();

    assert.deepEqual(
      sent.map((request) => `${request.url} ${request.lastEventId}`),
      [
        "https://api.antelopejs.cloud/api/cloud/services/s%2F1/logs?follow=true c-9",
        "https://api.antelopejs.cloud/api/cloud/services/s%2F1/logs null",
      ],
    );
  });
});
