import type { CloudApi, EnvironmentVariable } from "@antelopejs/cloud-sdk";
import { format, message } from "./i18n.js";
import { feedback, record, result } from "./output.js";
import {
  type Project,
  productionEnvironment,
  productionServices,
  type Service,
  serviceByName,
} from "./project.js";
import { linkedContext } from "./session.js";
import { withTask } from "./tasks.js";
import type { EnvSetOptions, GlobalOptions, Runtime } from "./types.js";
import {
  parseVariableAssignment,
  type VariableRow,
  variableWriteOf,
} from "./variables.js";

/** The linked project, its production environment and the client to talk to. */
interface EnvironmentContext {
  api: CloudApi;
  project: Project;
  environmentId: string;
  /** Service names by id, to name a variable's service and a wired value's publisher. */
  names: Map<string, string>;
}

async function environmentContext(
  runtime: Runtime,
  options: GlobalOptions,
): Promise<EnvironmentContext> {
  const { config, api } = await linkedContext(runtime, options);
  const project = await api.readProject(config.project);
  const names = new Map(
    productionServices(project).map((service) => [service.id, service.name]),
  );
  return {
    api,
    project,
    environmentId: productionEnvironment(project).id,
    names,
  };
}

/** The API's row with its service named; a row from an older API is not marked. */
function rowOf(
  context: EnvironmentContext,
  variable: EnvironmentVariable,
): VariableRow {
  return {
    service: context.names.get(variable.serviceId) ?? variable.serviceId,
    serviceId: variable.serviceId,
    key: variable.key,
    secret: variable.secret,
    value: variable.value,
    buildTime: variable.buildTime === true,
    origin: variable.origin,
  };
}

/**
 * What the table shows for a value: the value of a visible variable, its mask
 * for a secret, and the service a wired one follows, whose value may move.
 */
function shownValue(
  context: EnvironmentContext,
  row: VariableRow,
  lang?: string,
): string {
  if (row.origin.type === "resource") {
    return format("wiredValue", lang, {
      service: context.names.get(row.origin.serviceId) ?? row.origin.serviceId,
    });
  }
  if (row.secret) return message("secretValue", lang);
  return row.value ?? "-";
}

function byServiceThenKey(left: VariableRow, right: VariableRow): number {
  return (
    left.service.localeCompare(right.service) ||
    left.key.localeCompare(right.key)
  );
}

/**
 * The variables of the linked project's production services, or of one of
 * them: on stdout as a table, or as one `variables` record with `--json`.
 */
export async function envList(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName?: string,
): Promise<void> {
  const context = await environmentContext(runtime, options);
  const service: Service | undefined =
    serviceName === undefined
      ? undefined
      : serviceByName(context.project, serviceName);
  const list = await context.api.listVariables(
    context.project.id,
    context.environmentId,
  );
  const rows = list.variables
    .map((variable) => rowOf(context, variable))
    .filter((row) => service === undefined || row.serviceId === service.id)
    .sort(byServiceThenKey);
  const lang = options.lang;
  result(
    runtime,
    options,
    "variables",
    {
      project: context.project.slug,
      environment: productionEnvironment(context.project).name,
      variables: rows,
    },
    () => {
      if (rows.length === 0) {
        runtime.ui.message("info", message("noVariables", lang));
        return;
      }
      runtime.ui.table(rows, [
        { header: message("columnService", lang), value: (row) => row.service },
        { header: message("columnKey", lang), value: (row) => row.key },
        {
          header: message("columnValue", lang),
          value: (row) => shownValue(context, row, lang),
        },
        {
          header: message("columnBuild", lang),
          value: (row) =>
            message(row.buildTime ? "buildTimeOn" : "buildTimeOff", lang),
        },
      ]);
    },
  );
}

/**
 * Sets one variable of a service, then says so; a variable the builds get is
 * followed by the warning that its value is public. The value is checked
 * before the session is read, so a bad one is a usage error and no request.
 */
export async function envSet(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
  assignment: string,
  setOptions: EnvSetOptions,
): Promise<void> {
  const parsed = parseVariableAssignment(assignment, setOptions);
  const context = await environmentContext(runtime, options);
  const service = serviceByName(context.project, serviceName);
  const values = { key: parsed.key, service: service.name };
  const written = await withTask(runtime, options, {
    label: format("settingVariable", options.lang, values),
    work: () =>
      context.api.setVariable(
        context.project.id,
        context.environmentId,
        service.id,
        parsed.key,
        variableWriteOf(parsed, setOptions),
      ),
    done: format("variableSet", options.lang, values),
  });
  const row = rowOf(context, written);
  if (options.json) record(runtime, "variable_set", row);
  if (row.buildTime) {
    feedback(runtime, options, {
      type: "build_time_public",
      data: { service: service.name, key: row.key },
      level: "warn",
      text: format("buildTimePublic", options.lang, { key: row.key }),
    });
  }
}

/** Removes one variable of a service, a wired one included, then says so. */
export async function envUnset(
  runtime: Runtime,
  options: GlobalOptions,
  serviceName: string,
  key: string,
): Promise<void> {
  const context = await environmentContext(runtime, options);
  const service = serviceByName(context.project, serviceName);
  const values = { key, service: service.name };
  await withTask(runtime, options, {
    label: format("removingVariable", options.lang, values),
    work: () =>
      context.api.deleteVariable(
        context.project.id,
        context.environmentId,
        service.id,
        key,
      ),
    done: format("variableRemoved", options.lang, values),
  });
  if (options.json) {
    record(runtime, "variable_removed", { service: service.name, key });
  }
}
