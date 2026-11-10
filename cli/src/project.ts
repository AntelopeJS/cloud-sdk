import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { components } from "@antelopejs/cloud-sdk";
import { CliError } from "./errors.js";
import type { ProjectConfig, ServicePath } from "./types.js";

export type Project = components["schemas"]["Project"];
export type Service = components["schemas"]["Service"];

interface ResolvedServicePath {
  name: string;
  resolved: string;
}

export type Environment = components["schemas"]["Environment"];

/** Name of the environment `deploy` targets. */
export const PRODUCTION_ENVIRONMENT = "production";

export function productionEnvironment(project: Project): Environment {
  const environment =
    project.environments.find((item) => item.name === PRODUCTION_ENVIRONMENT) ??
    project.environments[0];
  if (!environment) throw new CliError("project_has_no_environment");
  return environment;
}

export function productionServices(project: Project): Service[] {
  return productionEnvironment(project).services;
}

/** The service's public URL, or null for a private service. */
export function publicUrl(service: Service): string | null {
  return service.primaryHost ? `https://${service.primaryHost}` : null;
}

export function serviceByName(project: Project, name: string): Service {
  const service = productionServices(project).find(
    (item) => item.name === name,
  );
  if (!service) throw new CliError("unknown_service", name);
  return service;
}

/**
 * The services in an order that ships each one after the ones it links to:
 * the tenants schema refuses an application whose links name one not
 * deployed yet, so a frontend sent before its web would never roll out.
 * Otherwise the given order holds; a cycle has no order and keeps it.
 */
export function backendsFirst(
  project: Project,
  names: readonly string[],
): string[] {
  const services = productionServices(project);
  const nameById = new Map(
    services.map((service) => [service.id, service.name]),
  );
  const linkedNames = new Map(
    services.map((service) => [
      service.name,
      new Set((service.linkedServiceIds ?? []).map((id) => nameById.get(id))),
    ]),
  );
  const ordered: string[] = [];
  let remaining = [...names];
  while (remaining.length > 0) {
    const ready = remaining.filter(
      (name) =>
        !remaining.some(
          (other) => other !== name && linkedNames.get(name)?.has(other),
        ),
    );
    const wave = ready.length > 0 ? ready : remaining;
    ordered.push(...wave);
    remaining = remaining.filter((name) => !wave.includes(name));
  }
  return ordered;
}

export function selectedServiceNames(
  config: ProjectConfig,
  root: string,
  cwd: string,
  requested?: string,
): string[] {
  if (requested) {
    if (!Object.hasOwn(config.services, requested))
      throw new CliError("unknown_service", requested);
    return [requested];
  }
  const location = relative(root, resolve(cwd));
  if (location === "") return Object.keys(config.services).sort();
  if (location.startsWith("..") || isAbsolute(location))
    throw new CliError("outside_project");
  const matches = Object.entries(config.services)
    .map(([name, service]): ResolvedServicePath => ({
      name,
      resolved: resolve(root, service.path),
    }))
    .filter((entry) => {
      const path = relative(entry.resolved, resolve(cwd));
      return path === "" || (!path.startsWith("..") && !isAbsolute(path));
    })
    .sort((left, right) => right.resolved.length - left.resolved.length);
  const match = matches[0];
  if (matches[1]?.resolved === match?.resolved) {
    throw new CliError("ambiguous_service_path");
  }
  if (!match) throw new CliError("service_path_not_found");
  return [match.name];
}

export function parseServicePaths(
  values: string[],
): Record<string, ServicePath> {
  return Object.fromEntries(
    values.map((value) => {
      const [name, path] = splitAssignment(value, "invalid_service_path");
      assertInside(path);
      return [name, { path }];
    }),
  );
}

function splitAssignment(value: string, code: string): [string, string] {
  const separator = value.indexOf("=");
  if (separator < 1 || separator === value.length - 1) {
    throw new CliError(code, value);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function assertInside(path: string): void {
  if (isAbsolute(path) || relative(".", path).startsWith("..")) {
    throw new CliError("service_path_outside_project", path);
  }
}

/**
 * The services with the Dockerfiles `--dockerfile <name>=<path>` gives them,
 * each path relative to its service's folder.
 */
export function withServiceDockerfiles(
  services: Record<string, ServicePath>,
  values: string[],
): Record<string, ServicePath> {
  const dockerfiles = values.map((value) =>
    splitAssignment(value, "invalid_service_dockerfile"),
  );
  for (const [name, path] of dockerfiles) {
    if (!Object.hasOwn(services, name))
      throw new CliError("invalid_service_dockerfile", name);
    assertInside(path);
  }
  return Object.fromEntries(
    Object.entries(services).map(([name, service]) => {
      const dockerfile = dockerfiles.find(([target]) => target === name)?.[1];
      return [name, dockerfile ? { ...service, dockerfile } : service];
    }),
  );
}

export async function resolveServiceRoot(
  projectRoot: string,
  servicePath: string,
): Promise<string> {
  const root = await realpath(projectRoot);
  const serviceRoot = await realpath(resolve(root, servicePath));
  const path = relative(root, serviceRoot);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new CliError("service_path_outside_project", servicePath);
  }
  return serviceRoot;
}
