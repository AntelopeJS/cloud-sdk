import { createHash, randomBytes } from "node:crypto";

/**
 * Longest DNS label. Project slugs and service names are labels, the same rule
 * the API validates them against.
 */
const MAX_DNS_LABEL_LENGTH = 63;
/** Longest application name the API accepts: it is the public subdomain. */
const MAX_APP_NAME_LENGTH = 40;
const MIN_PROJECT_SLUG_LENGTH = 2;
const HASH_SUFFIX_LENGTH = 8;
const RANDOM_SUFFIX_BYTES = 2;
const FIRST_SLUG_SUGGESTION = 2;
const MAX_SLUG_SUGGESTIONS = 50;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

const DIACRITICS = /[̀-ͯ]/g;
const NON_SLUG_CHARS = /[^a-z0-9-]+/g;
const DASH_RUNS = /-{2,}/g;
const EDGE_DASHES = /^-+|-+$/g;
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Normalises a free-form name into the API's slug alphabet: a lowercase
 * RFC 1123 label, accents folded rather than dropped.
 *
 * @param value Free-form name, such as a folder name
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(NON_SLUG_CHARS, "-")
    .replace(DASH_RUNS, "-")
    .replace(EDGE_DASHES, "")
    .slice(0, MAX_DNS_LABEL_LENGTH)
    .replace(EDGE_DASHES, "");
}

function isValidLabel(value: string): boolean {
  return value.length <= MAX_DNS_LABEL_LENGTH && SLUG_PATTERN.test(value);
}

/** Whether the API would store this project slug as-is. */
export function isValidProjectSlug(slug: string): boolean {
  return slug.length >= MIN_PROJECT_SLUG_LENGTH && isValidLabel(slug);
}

/** Whether the API would store this service name as-is. */
export function isValidServiceName(name: string): boolean {
  return isValidLabel(name);
}

/** Whether a value is a TCP port a service may listen on. */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * First free slug derived from the one asked for, the same `-2`, `-3`…
 * sequence the console suggests.
 *
 * @param desired Slug the user asked for
 * @param taken Slugs already visible in the workspace
 */
export function suggestProjectSlug(
  desired: string,
  taken: ReadonlySet<string>,
): string {
  const candidates = Array.from({ length: MAX_SLUG_SUGGESTIONS }, (_, index) =>
    withSuffix(desired, `${FIRST_SLUG_SUGGESTION + index}`),
  );
  return candidates.find((candidate) => !taken.has(candidate)) ?? desired;
}

function withSuffix(base: string, suffix: string): string {
  const room = MAX_DNS_LABEL_LENGTH - suffix.length - 1;
  return `${slugify(base.slice(0, room))}-${suffix}`;
}

/** Service names that add nothing to the project's own: the default drops them. */
const GENERIC_SERVICE_NAMES = new Set(["web", "app", "www"]);

/**
 * The part of a service's name the default adds to the project's: nothing
 * for a generic name, and never the words the project already starts with.
 *
 * @param projectSlug Project the service belongs to
 * @param serviceName Service being created
 */
function serviceSegment(projectSlug: string, serviceName: string): string {
  if (GENERIC_SERVICE_NAMES.has(serviceName)) return "";
  const projectWords = projectSlug.split("-");
  const words = serviceName.split("-");
  let shared = 0;
  while (shared < words.length && words[shared] === projectWords[shared]) {
    shared += 1;
  }
  return words.slice(shared).join("-");
}

/**
 * Public application name of the production service, `<project>-<service>`
 * without a generic service name (`web`, `app`, `www`) and without the words
 * the service repeats from the project, shortened with a stable digest when it
 * exceeds the API's 40 characters — the default the console suggests for the
 * same pair (src/naming/hosts.ts defaultSubdomainSlug).
 *
 * @param projectSlug Project the service belongs to
 * @param serviceName Service being created
 */
export function defaultAppName(
  projectSlug: string,
  serviceName: string,
): string {
  const label = [projectSlug, serviceSegment(projectSlug, serviceName)]
    .filter((part) => part.length > 0)
    .join("-");
  if (label.length <= MAX_APP_NAME_LENGTH) return label;
  const digest = createHash("sha256")
    .update(label)
    .digest("hex")
    .slice(0, HASH_SUFFIX_LENGTH);
  const prefix = label
    .slice(0, MAX_APP_NAME_LENGTH - HASH_SUFFIX_LENGTH - 1)
    .replace(/-+$/, "");
  return `${prefix}-${digest}`;
}

/**
 * An alternative application name for when the default is already someone
 * else's public subdomain: application names are unique platform-wide.
 *
 * @param appName Name that was refused
 */
export function alternativeAppName(appName: string): string {
  const suffix = randomBytes(RANDOM_SUFFIX_BYTES).toString("hex");
  const room = MAX_APP_NAME_LENGTH - suffix.length - 1;
  return `${appName.slice(0, room).replace(/-+$/, "")}-${suffix}`;
}
