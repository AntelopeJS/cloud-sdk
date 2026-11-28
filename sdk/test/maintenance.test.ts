import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CloudApi,
  CloudApiError,
  MAINTENANCE_WINDOW_DAYS,
  type MaintenanceWindow,
  type MaintenanceWindowView,
} from "../src/index.js";

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  body: string;
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
      body: await request.text(),
    });
    return answer();
  };
  return { sent, send };
}

/** A body the fake API answers in JSON. */
type JsonAnswer =
  | string
  | number
  | boolean
  | null
  | JsonAnswer[]
  | { [key: string]: JsonAnswer | undefined };

function jsonResponse(status: number, body: JsonAnswer): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const WINDOW_URL =
  "https://api.antelopejs.cloud/api/cloud/services/db%2F1/maintenance-window";
const TOKYO_MONDAYS: MaintenanceWindow = {
  day: "monday",
  startHour: 23,
  durationHours: 2,
  timeZone: "Asia/Tokyo",
};
const DEFAULT_VIEW: MaintenanceWindowView = {
  window: {
    day: "sunday",
    startHour: 2,
    durationHours: 3,
    timeZone: "Europe/Brussels",
  },
  isDefault: true,
  nextStart: "2026-11-29T01:00:00.000Z",
  nextEnd: "2026-11-29T04:00:00.000Z",
  canEdit: false,
};

describe("the maintenance window of a database", () => {
  test("is read at the encoded service path, with the window in force, its next opening and whether the caller may change it", async () => {
    const { sent, send } = recorder(() => jsonResponse(200, DEFAULT_VIEW));
    const api = new CloudApi({ token: "t-1", fetch: send });

    assert.deepEqual(await api.maintenanceWindows.read("db/1"), DEFAULT_VIEW);
    assert.deepEqual(
      sent.map((request) => `${request.method} ${request.url}`),
      [`GET ${WINDOW_URL}`],
    );
    assert.equal(sent[0]?.authorization, "Bearer t-1");
  });

  test("is put as the whole window, and an answer with no body is accepted", async () => {
    for (const status of [200, 204]) {
      const { sent, send } = recorder(() => new Response(null, { status }));
      const api = new CloudApi({ token: "t", fetch: send });

      assert.equal(
        await api.maintenanceWindows.set("db/1", TOKYO_MONDAYS),
        undefined,
      );

      assert.equal(sent[0]?.method, "PUT");
      assert.equal(sent[0]?.url, WINDOW_URL);
      assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), TOKYO_MONDAYS);
    }
  });

  test("is reset by a delete at the same path, with no body", async () => {
    const { sent, send } = recorder(() => new Response(null, { status: 200 }));
    const api = new CloudApi({ token: "t", fetch: send });

    assert.equal(await api.maintenanceWindows.reset("db/1"), undefined);

    assert.deepEqual(
      sent.map((request) => `${request.method} ${request.url} ${request.body}`),
      [`DELETE ${WINDOW_URL} `],
    );
  });

  test("names the days the API takes, Monday first", () => {
    assert.deepEqual(MAINTENANCE_WINDOW_DAYS, [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
  });
});

describe("a maintenance window the API refuses", () => {
  test("each refusal is a CloudApiError carrying its status and code", async () => {
    const refusals: Array<[number, string, (api: CloudApi) => Promise<void>]> =
      [
        [
          400,
          "cloud.errors.settings.invalid_maintenance_window",
          (api) =>
            api.maintenanceWindows.set("db/1", {
              ...TOKYO_MONDAYS,
              durationHours: 5,
            }),
        ],
        [
          400,
          "cloud.errors.settings.unknown_time_zone",
          (api) =>
            api.maintenanceWindows.set("db/1", {
              ...TOKYO_MONDAYS,
              timeZone: "Mars/Olympus",
            }),
        ],
        [
          403,
          "cloud.errors.settings.maintenance_window_owner_only",
          (api) => api.maintenanceWindows.reset("db/1"),
        ],
        [
          409,
          "cloud.errors.settings.maintenance_window_plan_locked",
          (api) => api.maintenanceWindows.set("db/1", TOKYO_MONDAYS),
        ],
        [
          404,
          "cloud.errors.settings.unknown_service",
          async (api) => {
            await api.maintenanceWindows.read("db/1");
          },
        ],
      ];

    for (const [status, code, call] of refusals) {
      for (const body of [code, { message: code }]) {
        const { send } = recorder(() => jsonResponse(status, body));
        const api = new CloudApi({ token: "t", fetch: send });
        await assert.rejects(call(api), (error) => {
          assert.ok(error instanceof CloudApiError);
          assert.equal(error.status, status);
          assert.equal(error.code, code);
          return true;
        });
      }
    }
  });
});

describe("the settings of a database", () => {
  test("carry the window in force with whether it is the default, and an older API without it still reads", async () => {
    const database = {
      engine: "postgres",
      mode: "single",
      label: "PostgreSQL",
      version: "17",
      host: "db.app.svc",
      maintenanceWindow: { ...TOKYO_MONDAYS, isDefault: false },
    };
    const settings = (withDatabase: JsonAnswer) => ({
      serviceId: "db/1",
      scaling: {
        bounds: { replicas: { min: 1, max: 1 }, cpu: 1, memory: 1 },
        replicaLimit: 1,
        pricing: null,
      },
      volumeLimits: { minGb: 1, maxGb: 10, removedRetentionDays: 7 },
      database: withDatabase,
    });
    const answers = [
      settings(database),
      settings({ ...database, maintenanceWindow: undefined }),
      settings(null),
    ];
    const { send } = recorder(() => jsonResponse(200, answers.shift() ?? null));
    const api = new CloudApi({ token: "t", fetch: send });

    const chosen = await api.serviceSettings("db/1");
    assert.deepEqual(chosen.database?.maintenanceWindow, {
      ...TOKYO_MONDAYS,
      isDefault: false,
    });
    const older = await api.serviceSettings("db/1");
    assert.equal(older.database?.maintenanceWindow, undefined);
    const app = await api.serviceSettings("db/1");
    assert.equal(app.database, null);
  });
});
