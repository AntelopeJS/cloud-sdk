import { type CloudApi, CloudApiError } from "@antelopejs/cloud-sdk";
import { CliError } from "./errors.js";
import { format, message } from "./i18n.js";
import {
  openingText,
  parseMaintenanceWindow,
  windowText,
} from "./maintenance-window.js";
import { record, result } from "./output.js";
import { type Service, serviceByName } from "./project.js";
import { linkedContext } from "./session.js";
import { withTask } from "./tasks.js";
import type { GlobalOptions, MaintenanceSetOptions, Runtime } from "./types.js";

/** The client and the service of the linked project's production environment a command names. */
interface ServiceTarget {
  api: CloudApi;
  service: Service;
}

/** The API's answer for a service it does not know as a managed database the caller manages. */
const UNKNOWN_SERVICE = "cloud.errors.settings.unknown_service";

/** A call on the service's window, an app refused as `not_a_database` under its name. */
async function onDatabase<Result>(
  service: Service,
  call: () => Promise<Result>,
): Promise<Result> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CloudApiError && error.code === UNKNOWN_SERVICE) {
      throw new CliError("not_a_database", {
        detail: service.name,
        cause: error,
      });
    }
    throw error;
  }
}

async function serviceTarget(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
): Promise<ServiceTarget> {
  const { config, api } = await linkedContext(runtime, options);
  const project = await api.readProject(config.project);
  return { api, service: serviceByName(project, serviceName) };
}

/**
 * The maintenance window of a managed database: on stdout, the window in
 * force and whether it is the platform's default, its next opening on the
 * window's own clock, and whether the caller may change it; with `--json`,
 * one `maintenance_window` record.
 */
export async function maintenanceShow(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
): Promise<void> {
  const { api, service } = await serviceTarget(runtime, options, serviceName);
  const view = await onDatabase(service, () =>
    api.maintenanceWindows.read(service.id),
  );
  const lang = options.lang;
  const shown = windowText(view.window, lang);
  result(
    runtime,
    options,
    "maintenance_window",
    { service: service.name, serviceId: service.id, ...view },
    () =>
      runtime.ui.details([
        {
          label: message("maintenanceWindow", lang),
          value: view.isDefault
            ? format("maintenanceDefault", lang, { window: shown })
            : shown,
        },
        {
          label: message("maintenanceNext", lang),
          value: openingText(
            view.nextStart,
            view.nextEnd,
            view.window.timeZone,
          ),
        },
        {
          label: message("maintenanceCanEdit", lang),
          value: message(
            view.canEdit ? "maintenanceEditable" : "maintenanceOwnerOnly",
            lang,
          ),
        },
      ]),
  );
}

/**
 * Chooses the maintenance window of a managed database. The window is checked
 * before the session is read, so a bad one is a usage error and no request.
 */
export async function maintenanceSet(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
  setOptions: MaintenanceSetOptions,
): Promise<void> {
  const window = parseMaintenanceWindow(setOptions);
  const { api, service } = await serviceTarget(runtime, options, serviceName);
  const lang = options.lang;
  await withTask(runtime, options, {
    label: format("settingMaintenance", lang, { service: service.name }),
    work: () =>
      onDatabase(service, () => api.maintenanceWindows.set(service.id, window)),
    done: format("maintenanceSet", lang, {
      service: service.name,
      window: windowText(window, lang),
    }),
  });
  if (options.json) {
    record(runtime, "maintenance_window_set", {
      service: service.name,
      serviceId: service.id,
      window,
    });
  }
}

/** Drops the window the owner chose: the platform's default applies again. */
export async function maintenanceReset(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
): Promise<void> {
  const { api, service } = await serviceTarget(runtime, options, serviceName);
  const values = { service: service.name };
  await withTask(runtime, options, {
    label: format("resettingMaintenance", options.lang, values),
    work: () =>
      onDatabase(service, () => api.maintenanceWindows.reset(service.id)),
    done: format("maintenanceReset", options.lang, values),
  });
  if (options.json) {
    record(runtime, "maintenance_window_reset", {
      service: service.name,
      serviceId: service.id,
    });
  }
}
