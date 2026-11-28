import type { ProblemTexts } from "./problem-text.js";

const WINDOW_RULE =
  "A maintenance window opens on a day of the week (monday to sunday), at a whole hour from 0 to 23, for 1 to 4 hours, read in an IANA time zone such as Europe/Brussels.";

/** The maintenance window of a managed database: its usage errors and its refusals. */
export const MAINTENANCE_EN: ProblemTexts = {
  invalid_maintenance_day: {
    title: 'Invalid --day value "{detail}"',
    reason: WINDOW_RULE,
    fixes: ["Pass a day of the week, such as --day sunday"],
  },
  invalid_maintenance_start: {
    title: 'Invalid --start value "{detail}"',
    reason: WINDOW_RULE,
    fixes: ["Pass the hour the window opens, such as --start 2 for 02:00"],
  },
  invalid_maintenance_hours: {
    title: 'Invalid --hours value "{detail}"',
    reason: WINDOW_RULE,
    fixes: ["Pass how long the window stays open, such as --hours 3"],
  },
  invalid_maintenance_zone: {
    title: 'Unknown time zone "{detail}"',
    reason: WINDOW_RULE,
    fixes: ["Pass an IANA time zone, such as --zone Europe/Brussels"],
  },
  not_a_database: {
    title: "{detail} is not a managed database",
    reason: "Only a managed database has a maintenance window.",
    fixes: ["Run ajs-cloud status to see the services of the project"],
  },
  "api.invalidMaintenanceWindow": {
    title: "The API refused the maintenance window",
    reason: WINDOW_RULE,
  },
  "api.unknownTimeZone": {
    title: "The API knows no time zone by that name",
    fixes: ["Pass an IANA time zone, such as --zone Europe/Brussels"],
  },
  "api.maintenanceOwnerOnly": {
    title: "Only the workspace owner can change a maintenance window",
    reason:
      "Members who manage the database can read its window, not choose it.",
    fixes: ["Ask the owner of the workspace to change it"],
  },
  "api.maintenancePlanLocked": {
    title: "Your plan runs the platform's maintenance window",
    reason:
      "On Free, every database is maintained on Sunday from 02:00 to 05:00, Europe/Brussels time.",
    fixes: ["Move the workspace to a paid plan to choose a window"],
  },
};
