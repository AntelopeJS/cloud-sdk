import assert from "node:assert/strict";
import { buffer } from "node:stream/consumers";
import { describe, test } from "node:test";
import {
  CloudApiError,
  MAINTENANCE_WINDOW_DAYS,
  MAINTENANCE_WINDOW_DURATION_HOURS,
  MAINTENANCE_WINDOW_START_HOURS,
} from "@antelopejs/cloud-sdk";
import { describeApiError, describeFailure } from "../src/error-messages.js";
import { CliError } from "../src/errors.js";
import {
  openingText,
  parseMaintenanceWindow,
  WINDOW_DAYS,
  WINDOW_DURATION_HOURS,
  WINDOW_START_HOURS,
  windowText,
} from "../src/maintenance-window.js";
import { type JsonValue, jsonAt, parseJson } from "./json.js";
import {
  fixture,
  json,
  PROJECT_PATH,
  project,
  reply,
  requests,
  routes,
  run,
  runBinary,
  serveMockApi,
  types,
} from "./ux-fixture.js";

serveMockApi();

const WINDOW_PATH = "/api/cloud/services/service-db/maintenance-window";
const DEFAULT_VIEW = {
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
const SET_ARGS = [
  "services",
  "maintenance-window",
  "set",
  "postgres",
  "--day",
  "Tuesday",
  "--start",
  "23",
  "--hours",
  "2",
  "--zone",
  " Asia/Tokyo ",
];

/** The fixture's project, with a managed database next to its web service. */
function projectWithDatabase(): JsonValue {
  const base = project();
  const [environment] = base.environments;
  return {
    ...base,
    environments: [
      {
        ...environment,
        services: [
          ...(environment?.services ?? []),
          {
            id: "service-db",
            name: "postgres",
            status: "unknown",
            primaryHost: null,
            deployment: null,
          },
        ],
      },
    ],
  };
}

async function databaseFixture() {
  const current = await fixture();
  routes[PROJECT_PATH] = reply(200, projectWithDatabase());
  return current;
}

describe("services maintenance-window show", () => {
  test("shows the window in force, its next opening on its own clock, and who may change it", async () => {
    const current = await databaseFixture();
    routes[WINDOW_PATH] = reply(200, DEFAULT_VIEW);
    await run(current.runtime, [
      "services",
      "maintenance-window",
      "show",
      "postgres",
    ]);
    await run(current.runtime, [
      "--lang",
      "fr",
      "services",
      "maintenance-window",
      "show",
      "postgres",
    ]);
    assert.deepEqual(current.streams.stdout, [
      "Window        Sunday 02:00–05:00 (Europe/Brussels), the platform's default",
      "Next opening  2026-11-29 02:00–05:00 (Europe/Brussels)",
      "Change        no: only the workspace owner can, on a paid plan",
      "Fenêtre              dimanche 02:00–05:00 (Europe/Brussels), celle de la plateforme par défaut",
      "Prochaine ouverture  2026-11-29 02:00–05:00 (Europe/Brussels)",
      "Modifiable           non : seul le propriétaire de l’espace de travail le peut, sur une offre payante",
    ]);
  });

  test("writes one maintenance_window record with the service named", async () => {
    const current = await databaseFixture();
    routes[WINDOW_PATH] = reply(200, { ...DEFAULT_VIEW, canEdit: true });
    await run(current.runtime, [
      "--json",
      "services",
      "maintenance-window",
      "show",
      "postgres",
    ]);
    assert.deepEqual(types(current.output), ["maintenance_window"]);
    const record = parseJson(current.output[0] ?? "");
    assert.deepEqual(jsonAt(record, "data"), {
      service: "postgres",
      serviceId: "service-db",
      ...DEFAULT_VIEW,
      canEdit: true,
    });
  });

  test("an app the API does not know as a database is refused under its name", async () => {
    const current = await databaseFixture();
    routes["/api/cloud/services/service-web/maintenance-window"] = reply(
      404,
      "cloud.errors.settings.unknown_service",
    );
    await assert.rejects(
      run(current.runtime, ["services", "maintenance-window", "show", "web"]),
      (error) =>
        error instanceof CliError &&
        error.code === "not_a_database" &&
        describeFailure(error, "en")?.title === "web is not a managed database",
    );
  });
});

describe("services maintenance-window set", () => {
  test("puts the window as typed, lower-cased and trimmed, then says so", async () => {
    const current = await databaseFixture();
    const bodies: string[] = [];
    routes[`PUT ${WINDOW_PATH}`] = async (request, response) => {
      bodies.push((await buffer(request)).toString("utf8"));
      json(response, 200, null);
    };
    await run(current.runtime, SET_ARGS);
    await run(current.runtime, ["--json", ...SET_ARGS]);
    const sent = {
      day: "tuesday",
      startHour: 23,
      durationHours: 2,
      timeZone: "Asia/Tokyo",
    };
    assert.deepEqual(bodies.map(parseJson), [sent, sent]);
    assert.equal(
      current.output[0],
      "✔ Maintenance window of postgres: Tuesday 23:00–01:00 (Asia/Tokyo)",
    );
    assert.deepEqual(types(current.output.slice(1)), [
      "maintenance_window_set",
    ]);
    assert.deepEqual(jsonAt(parseJson(current.output[1] ?? ""), "data"), {
      service: "postgres",
      serviceId: "service-db",
      window: sent,
    });
  });

  test("a refusal of the owner or the plan is told in both languages", () => {
    const owner = new CloudApiError(
      403,
      "cloud.errors.settings.maintenance_window_owner_only",
    );
    assert.equal(
      describeApiError(owner, "en").title,
      "Only the workspace owner can change a maintenance window",
    );
    assert.equal(
      describeApiError(owner, "fr").title,
      "Seul le propriétaire de l’espace de travail peut modifier une fenêtre de maintenance",
    );
    const plan = new CloudApiError(
      409,
      "cloud.errors.settings.maintenance_window_plan_locked",
    );
    assert.match(describeApiError(plan, "en").reason ?? "", /On Free/);
    assert.match(describeApiError(plan, "fr").reason ?? "", /Sur Free/);
  });
});

describe("services maintenance-window set: what is refused before any request", () => {
  test("a day, an hour, a duration or a zone the API would refuse is a usage error naming it", async () => {
    const valid = { day: "sunday", start: "2", hours: "3", zone: "UTC" };
    const refused: Array<[keyof typeof valid, string, string]> = [
      ["day", "dimanche", "invalid_maintenance_day"],
      ["day", "sun", "invalid_maintenance_day"],
      ["start", "24", "invalid_maintenance_start"],
      ["start", "-1", "invalid_maintenance_start"],
      ["start", "2.5", "invalid_maintenance_start"],
      ["start", "02:00", "invalid_maintenance_start"],
      ["hours", "0", "invalid_maintenance_hours"],
      ["hours", "5", "invalid_maintenance_hours"],
      ["zone", "Mars/Olympus", "invalid_maintenance_zone"],
      ["zone", " ", "invalid_maintenance_zone"],
    ];
    for (const [option, value, code] of refused) {
      assert.throws(
        () => parseMaintenanceWindow({ ...valid, [option]: value }),
        (error) =>
          error instanceof CliError &&
          error.code === code &&
          error.detail === value &&
          describeFailure(error, "en")?.exitCode === 2,
        `${option}=${value}`,
      );
    }
    assert.deepEqual(
      parseMaintenanceWindow({
        day: "MONDAY",
        start: "0",
        hours: "4",
        zone: "UTC",
      }),
      { day: "monday", startHour: 0, durationHours: 4, timeZone: "UTC" },
    );

    const current = await databaseFixture();
    const before = requests.length;
    await assert.rejects(
      run(
        current.runtime,
        SET_ARGS.map((arg) => (arg === "2" ? "5" : arg)),
      ),
      (error) =>
        error instanceof CliError && error.code === "invalid_maintenance_hours",
    );
    const missing = await runBinary(
      ["--json", ...SET_ARGS.slice(0, -2)],
      current,
    );
    assert.equal(missing.status, 2);
    assert.equal(
      jsonAt(parseJson(missing.stderr), "error", "code"),
      "commander.missingMandatoryOptionValue",
    );
    assert.equal(requests.length, before);
  });

  test("the days and the bounds are the SDK's", () => {
    assert.deepEqual(WINDOW_DAYS, MAINTENANCE_WINDOW_DAYS);
    assert.deepEqual(WINDOW_START_HOURS, MAINTENANCE_WINDOW_START_HOURS);
    assert.deepEqual(WINDOW_DURATION_HOURS, MAINTENANCE_WINDOW_DURATION_HOURS);
  });

  test("a window past midnight ends on the next day's hour, and an opening names the end's date when it moves", () => {
    const window = {
      day: "saturday" as const,
      startHour: 22,
      durationHours: 4,
      timeZone: "UTC",
    };
    assert.equal(windowText(window), "Saturday 22:00–02:00 (UTC)");
    assert.equal(
      openingText("2026-11-28T22:00:00Z", "2026-11-29T02:00:00Z", "UTC"),
      "2026-11-28 22:00–2026-11-29 02:00 (UTC)",
    );
  });
});

describe("services maintenance-window reset", () => {
  test("deletes the window at its path and says the default applies again", async () => {
    const current = await databaseFixture();
    routes[`DELETE ${WINDOW_PATH}`] = (_, response) => {
      response.writeHead(200);
      response.end();
    };
    await run(current.runtime, [
      "services",
      "maintenance-window",
      "reset",
      "postgres",
    ]);
    await run(current.runtime, [
      "--json",
      "services",
      "maintenance-window",
      "reset",
      "postgres",
    ]);
    assert.deepEqual(current.output.slice(0, 1), [
      "✔ postgres is back on the platform's maintenance window",
    ]);
    assert.deepEqual(types(current.output.slice(1)), [
      "maintenance_window_reset",
    ]);
    assert.ok(requests.includes(`DELETE ${WINDOW_PATH}`));
  });
});
