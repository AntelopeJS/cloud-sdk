import type { CloudApi, components } from "@antelopejs/cloud-sdk";
import { type Language, language, type MessageKey, message } from "./i18n.js";
import { record } from "./output.js";
import { PRODUCTION_ENVIRONMENT } from "./project.js";
import type { GlobalOptions, Runtime } from "./types.js";

type ServiceSettings = components["schemas"]["ServiceSettings"];

const LABEL_GAP = 2;
const UPLOAD_SOURCE = "upload";
const LOCALES = { en: "en-GB", fr: "fr-FR" } as const satisfies Record<
  Language,
  string
>;

/** What a first deployment is about to create, or reuse, before it asks. */
export interface DeployPlan {
  project: string;
  isNewProject: boolean;
  region: string;
  service: string;
  isNewService: boolean;
  /** Null for a service that already exists: its port is its own. */
  port: number | null;
  /** Monthly ceiling, formatted; null until a service exists to price. */
  ceiling: string | null;
}

function marked(value: string, isNew: boolean, lang?: string): string {
  const mark = isNew ? message("new", lang) : message("existing", lang);
  return `${value} (${mark})`;
}

function planRows(plan: DeployPlan, lang?: string): [string, string][] {
  const service = marked(plan.service, plan.isNewService, lang);
  const rows: [MessageKey, string][] = [
    ["planProject", marked(plan.project, plan.isNewProject, lang)],
    ["planRegion", plan.region],
    ["planEnvironment", PRODUCTION_ENVIRONMENT],
    ["planService", plan.port === null ? service : `${service} :${plan.port}`],
    ["planSource", message("planSourceUpload", lang)],
    ["ceiling", plan.ceiling ?? message("ceilingUnknown", lang)],
  ];
  return rows.map(([key, value]) => [message(key, lang), value]);
}

/**
 * Shows the plan the user confirms: its rows on stderr, as feedback before
 * the question, or one JSON record.
 */
export function showPlan(
  runtime: Runtime,
  options: GlobalOptions,
  plan: DeployPlan,
): void {
  if (options.json) {
    record(runtime, "deploy_plan", {
      ...plan,
      environment: PRODUCTION_ENVIRONMENT,
      source: UPLOAD_SOURCE,
    });
    return;
  }
  const rows = planRows(plan, options.lang);
  const width = Math.max(...rows.map(([label]) => label.length)) + LABEL_GAP;
  runtime.ui.message("info", message("planTitle", options.lang), {
    details: rows.map(([label, value]) => `${label.padEnd(width)}${value}`),
  });
}

function formatCeiling(
  settings: ServiceSettings,
  lang?: string,
): string | null {
  const { bounds, replicaLimit, pricing } = settings.scaling;
  if (!pricing) return null;
  const replicas = Math.max(Math.min(bounds.replicas.max, replicaLimit), 1);
  const hourly =
    bounds.cpu * pricing.cpuHourUnitPrice +
    bounds.memory * pricing.memoryHourUnitPrice;
  const amount = new Intl.NumberFormat(LOCALES[language(lang)], {
    style: "currency",
    currency: pricing.currency,
  }).format(replicas * hourly * pricing.hoursPerMonth);
  return `${amount}${message("perMonth", lang)}`;
}

/**
 * The service's monthly cost ceiling — its max bounds held all month at the
 * workspace's rates — or null when it cannot be read.
 *
 * Informational only: a workspace without a pricing grid, or a read refused,
 * must not stop a deployment the user already confirmed.
 */
export async function readCeiling(
  api: CloudApi,
  serviceId: string,
  lang?: string,
): Promise<string | null> {
  try {
    return formatCeiling(await api.serviceSettings(serviceId), lang);
  } catch {
    return null;
  }
}
