/** The production API, and the app domain deployed services answer on. */
const PRODUCTION_HOSTS = new Set(["api.antelopejs.cloud"]);
const PRODUCTION_APP_DOMAIN = "antelopejs.io";
/** Where the manifest says the source and the registry are. */
const PACKAGE_METADATA_HOSTS = new Set(["github.com", "registry.npmjs.org"]);
/** RFC 2606 and RFC 6761 names for documentation, which never reach a deployment. */
const RESERVED_HOST = /(?:^|\.)(?:example(?:\.com|\.org|\.net)?|test|invalid)$/;
/**
 * The host after `://`, whatever the scheme, even a template's
 * (`${secure ? "wss" : "ws"}://`): past a userinfo, which may hold an `@` but
 * no punctuation that ends a URL in prose; past a leading template label
 * (`${bucket}.s3.amazonaws.com`); a name or a bracketed IPv6 address. A host
 * that is only a template, such as `https://${host}`, names no host.
 */
const URL_HOST_PATTERN =
  /:\/\/(?:[a-z0-9._~%!$&+=:@-]*@)?(?:\$\{[^}]*\}\.)?(\[[0-9a-z:.%]+\]|[a-z0-9_.-]+)/gi;
/** A host of ours written without a scheme, such as a constant a URL is built from. */
const OWN_HOST_PATTERN = /\b((?:[a-z0-9-]+\.)*antelopejs\.[a-z]{2,})\b/gi;
const OWN_DOMAIN = /(?:^|\.)antelopejs\.[a-z]{2,}$/;
/**
 * Names and addresses that only resolve inside a private network or cluster:
 * cluster and Tailscale names, RFC 1918, shared (RFC 6598) and link-local
 * IPv4, and unique local and link-local IPv6.
 */
const PRIVATE_NETWORK_HOST =
  /(?:^|\.)(?:internal|local|lan|svc|ts\.net)$|^(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|169\.254)(?:\.\d{1,3}){2,3}$|^\[f(?:[cd][0-9a-f]{0,2}|e[89ab][0-9a-f]?):/;
/**
 * Where a host written without a scheme ends: not before a letter, a digit or
 * a hyphen, nor before a dot that a name continues after, as in
 * `settings.local.json`. A dot that ends a sentence ends the host.
 */
const HOST_END = String.raw`(?![a-z0-9-]|\.[a-z0-9])`;
/** Cluster and Tailscale names, which no source text names otherwise. */
const CLUSTER_NAME_PATTERN = new RegExp(
  String.raw`\b((?:[a-z0-9-]+\.)+(?:cluster\.local|ts\.net))` + HOST_END,
  "gi",
);
/**
 * Private-network names followed by a port or a path, so that property
 * access such as `options.internal` and file names such as
 * `Dockerfile.internal` are not hosts.
 */
const PRIVATE_NAME_PATTERN =
  /\b((?:[a-z0-9-]+\.)+(?:internal|svc|local|lan))(?=:\d|\/)/gi;
/**
 * A private IPv4 address that is not the tail of a longer dotted number, such
 * as an OID or a version.
 */
const PRIVATE_ADDRESS_PATTERN = new RegExp(
  String.raw`(?<![\d.])((?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|169\.254)(?:\.\d{1,3}){2})` +
    HOST_END,
  "g",
);
/**
 * The places a host is read from, each with the host as its first group: a
 * URL, a name of ours, and a private-network name or address written without
 * a scheme.
 */
const HOST_PATTERNS = [
  URL_HOST_PATTERN,
  OWN_HOST_PATTERN,
  CLUSTER_NAME_PATTERN,
  PRIVATE_NAME_PATTERN,
  PRIVATE_ADDRESS_PATTERN,
];

export const STAGING_PATTERN = /staging/i;

/**
 * Whether a host is production's or one no deployment answers on.
 * @param {string} name A host, lower-case, without a trailing dot
 */
export function isPublishableHost(name) {
  return (
    PRODUCTION_HOSTS.has(name) ||
    name === PRODUCTION_APP_DOMAIN ||
    name.endsWith(`.${PRODUCTION_APP_DOMAIN}`) ||
    PACKAGE_METADATA_HOSTS.has(name) ||
    RESERVED_HOST.test(name)
  );
}

/**
 * Whether a host belongs to a deployment that is not public: one of ours that
 * is not production's, one that says staging, or a private network's.
 * @param {string} name A host, lower-case, without a trailing dot
 */
export function isPrivateHost(name) {
  if (RESERVED_HOST.test(name)) return false;
  if (STAGING_PATTERN.test(name) || PRIVATE_NETWORK_HOST.test(name))
    return true;
  return OWN_DOMAIN.test(name) && !isPublishableHost(name);
}

/**
 * The hosts one line names, each once.
 * @param {string} line
 * @returns {Set<string>}
 */
export function hostsOf(line) {
  return new Set(
    HOST_PATTERNS.flatMap((pattern) =>
      [...line.matchAll(pattern)].map(([, host]) =>
        host.toLowerCase().replace(/\.+$/, ""),
      ),
    ),
  );
}
