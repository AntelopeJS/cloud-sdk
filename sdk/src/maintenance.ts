import type { Client } from "openapi-fetch";
import type { components, paths } from "./generated/cloud-api.js";
import { acceptedOf, dataOf } from "./result.js";

/** A weekly slot the platform may restart a managed database in to apply an update. */
export type MaintenanceWindow = components["schemas"]["MaintenanceWindow"];
export type MaintenanceWindowDay =
  components["schemas"]["MaintenanceWindowDay"];
/** The window in force for a database, when it next opens, and whether the caller may change it. */
export type MaintenanceWindowView =
  components["schemas"]["MaintenanceWindowView"];

/** The days a window may open on, Monday first, as the API spells them. */
export const MAINTENANCE_WINDOW_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly MaintenanceWindowDay[];

/** The hours a window may open at, in its time zone. */
export const MAINTENANCE_WINDOW_START_HOURS = { min: 0, max: 23 } as const;
/** How long a window may stay open, in whole hours. */
export const MAINTENANCE_WINDOW_DURATION_HOURS = { min: 1, max: 4 } as const;

type CloudClient = Client<paths>;

const WINDOW = "/api/cloud/services/{serviceId}/maintenance-window";

/**
 * The maintenance window of a managed database: the weekly slot in which the
 * platform applies the updates it holds back for it. A database whose owner
 * chose none runs the platform's default, Sunday 02:00 to 05:00 in
 * Europe/Brussels. Each call takes the database's service id; an app is
 * refused with 404 `cloud.errors.settings.unknown_service`.
 */
export class MaintenanceWindowsApi {
  constructor(private readonly client: CloudClient) {}

  /**
   * The window in force: the owner's or the default (`isDefault`), the
   * opening in progress or the next one as ISO 8601 instants, and whether
   * the caller may change it (`canEdit`).
   */
  async read(serviceId: string): Promise<MaintenanceWindowView> {
    const result = await this.client.GET(WINDOW, {
      params: { path: { serviceId } },
    });
    return dataOf(result);
  }

  /**
   * Chooses the window: a day, a start hour from 0 to 23 and a duration of 1
   * to 4 hours, read in an IANA time zone. The workspace's owner only, on a
   * paid plan. Refused with 400 `cloud.errors.settings.invalid_maintenance_window`
   * or `cloud.errors.settings.unknown_time_zone`, 403
   * `cloud.errors.settings.maintenance_window_owner_only`, and 409
   * `cloud.errors.settings.maintenance_window_plan_locked` on Free.
   */
  async set(serviceId: string, window: MaintenanceWindow): Promise<void> {
    const result = await this.client.PUT(WINDOW, {
      params: { path: { serviceId } },
      body: window,
      parseAs: "text",
    });
    acceptedOf(result);
  }

  /**
   * Drops the owner's window, so the platform's default applies again. The
   * same refusals as {@link MaintenanceWindowsApi.set}, but the 400s.
   */
  async reset(serviceId: string): Promise<void> {
    const result = await this.client.DELETE(WINDOW, {
      params: { path: { serviceId } },
      parseAs: "text",
    });
    acceptedOf(result);
  }
}
