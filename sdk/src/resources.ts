import type { components } from "./generated/cloud-api.js";

type Schemas = components["schemas"];

/** The runtime tier of a workspace's plan. */
export type AppTier = Schemas["AppTier"];
export type DatabaseEngine = Schemas["DatabaseEngine"];
export type DatabaseMode = Schemas["DatabaseMode"];

/**
 * A monthly amount. A plan that rates nothing a database holds includes it:
 * `included` is true and there is no amount to show.
 */
export type MonthlyCost = Schemas["MonthlyCost"];

/** A database an environment runs. */
export type EnvironmentResource = Schemas["EnvironmentResource"];

/** The databases an environment runs. */
export type EnvironmentResources = Schemas["EnvironmentResources"];

/** A database Cloud would create for a module of the project. */
export type PlannedResource = Schemas["PlannedResource"];

/** A database of the environment that already satisfies a module. */
export type ExistingResource = Schemas["ExistingResource"];

/**
 * A module whose need Cloud cannot provide: `not_offered` when Cloud does not
 * run it, `not_on_plan` (with the cheapest `requiredTier`) when the
 * workspace's plan does not include it.
 */
export type UnprovidedResource = Schemas["UnprovidedResource"];

/** A count held against a ceiling, before and after the plan is applied. */
export type CeilingUse = Schemas["CeilingUse"];

/**
 * What the environment's ceilings leave for the plan: the services it may
 * hold, and, on Free, the databases.
 */
export type ResourcePlanLimits = Schemas["ResourcePlanLimits"];

/**
 * Why an apply is refused with a 409 before any write: `preview_environment`,
 * `services_per_environment` or `databases_per_environment`. The apply answers
 * with the error key of the plan's first one.
 */
export type ResourcePlanRefusal = Schemas["ResourcePlanRefusal"];

/** What applying a project's modules to an environment would do. */
export type ResourcePlan = Schemas["ResourcePlan"];

/** The databases an apply created, and the plan that remains. */
export type AppliedResources = Schemas["AppliedResources"];
