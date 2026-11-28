import type {
  MaintenanceWindow,
  MaintenanceWindowDay,
} from "@antelopejs/cloud-sdk";
import { CliError } from "./errors.js";
import { format, type MessageKey, message } from "./i18n.js";
import type { MaintenanceSetOptions } from "./types.js";

/**
 * The days the API takes, Monday first: the SDK's `MAINTENANCE_WINDOW_DAYS`,
 * kept here so a usage error never loads the SDK.
 */
export const WINDOW_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly MaintenanceWindowDay[];

/** The SDK's `MAINTENANCE_WINDOW_START_HOURS` and `MAINTENANCE_WINDOW_DURATION_HOURS`. */
export const WINDOW_START_HOURS = { min: 0, max: 23 } as const;
export const WINDOW_DURATION_HOURS = { min: 1, max: 4 } as const;

const HOURS_PER_DAY = 24;
const WHOLE_HOURS_PATTERN = /^\d{1,2}$/;
/** The length of `2026-11-29`, the date a wall-clock reading starts with. */
const DATE_LENGTH = 10;

const DAY_NAMES: Record<MaintenanceWindowDay, MessageKey> = {
  monday: "dayMonday",
  tuesday: "dayTuesday",
  wednesday: "dayWednesday",
  thursday: "dayThursday",
  friday: "dayFriday",
  saturday: "daySaturday",
  sunday: "daySunday",
};

function dayOf(text: string): MaintenanceWindowDay | undefined {
  const typed = text.trim().toLowerCase();
  return WINDOW_DAYS.find((day) => day === typed);
}

function wholeHoursOf(
  text: string,
  bounds: { min: number; max: number },
): number | undefined {
  const typed = text.trim();
  if (!WHOLE_HOURS_PATTERN.test(typed)) return undefined;
  const hours = Number(typed);
  return hours >= bounds.min && hours <= bounds.max ? hours : undefined;
}

/**
 * Whether the runtime knows a time zone by that name, as the API checks it.
 *
 * @param timeZone The name as typed, trimmed
 */
function isKnownTimeZone(timeZone: string): boolean {
  if (timeZone === "") return false;
  try {
    return (
      new Intl.DateTimeFormat("en-GB", { timeZone }).resolvedOptions()
        .timeZone !== ""
    );
  } catch {
    return false;
  }
}

/**
 * The window `set` sends, from its options as typed: a day of the week in any
 * case, a start hour from 0 to 23, a duration of 1 to 4 hours and a time zone
 * the runtime knows. Anything else is a usage error naming the value, before
 * any request.
 *
 * @param options The options of `services maintenance-window set`
 */
export function parseMaintenanceWindow(
  options: MaintenanceSetOptions,
): MaintenanceWindow {
  const day = dayOf(options.day);
  if (day === undefined)
    throw new CliError("invalid_maintenance_day", options.day);
  const startHour = wholeHoursOf(options.start, WINDOW_START_HOURS);
  if (startHour === undefined)
    throw new CliError("invalid_maintenance_start", options.start);
  const durationHours = wholeHoursOf(options.hours, WINDOW_DURATION_HOURS);
  if (durationHours === undefined)
    throw new CliError("invalid_maintenance_hours", options.hours);
  const timeZone = options.zone.trim();
  if (!isKnownTimeZone(timeZone))
    throw new CliError("invalid_maintenance_zone", options.zone);
  return { day, startHour, durationHours, timeZone };
}

function clockHour(hour: number): string {
  return `${String(hour % HOURS_PER_DAY).padStart(2, "0")}:00`;
}

/**
 * A window as a person reads it: `Sunday 02:00–05:00 (Europe/Brussels)`; one
 * that runs past midnight ends on the next day's hour.
 *
 * @param window The window
 * @param lang The language of the day's name
 */
export function windowText(window: MaintenanceWindow, lang?: string): string {
  return format("maintenanceWindowText", lang, {
    day: message(DAY_NAMES[window.day], lang),
    start: clockHour(window.startHour),
    end: clockHour(window.startHour + window.durationHours),
    zone: window.timeZone,
  });
}

/** An instant on the wall clock of a zone, as `2026-11-29 02:00`. */
function wallClock(instant: string, timeZone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const field = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.get(type) ?? "";
  return `${field("year")}-${field("month")}-${field("day")} ${field("hour")}:${field("minute")}`;
}

/**
 * One opening of a window, on the wall clock of the window's zone:
 * `2026-11-29 02:00–05:00 (Europe/Brussels)`, with the end's date when it
 * falls on the next day.
 *
 * @param start The opening, as an ISO 8601 instant
 * @param end The first instant it is closed again
 * @param timeZone The window's zone
 */
export function openingText(
  start: string,
  end: string,
  timeZone: string,
): string {
  const from = wallClock(start, timeZone);
  const to = wallClock(end, timeZone);
  const sameDay = from.slice(0, DATE_LENGTH) === to.slice(0, DATE_LENGTH);
  const shownEnd = sameDay ? to.slice(DATE_LENGTH + 1) : to;
  return `${from}–${shownEnd} (${timeZone})`;
}
