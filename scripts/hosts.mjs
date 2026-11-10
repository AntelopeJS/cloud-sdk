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
/** Names and RFC 1918 addresses that only resolve inside a private network or cluster. */
const PRIVATE_NETWORK_HOST =
  /(?:^|\.)(?:internal|local|lan|svc)$|^(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}$/;
/**
 * A cluster name or an RFC 1918 address written without a scheme, such as an
 * upstream in a config file. A name that continues, as `settings.local.json`
 * does, is a file, not a host.
 */
const PRIVATE_NETWORK_PATTERN =
  /\b((?:[a-z0-9-]+\.)+(?:svc|cluster\.local|internal)|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?![a-z0-9.-])/gi;

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
  const hosts = [...line.matchAll(URL_HOST_PATTERN)].map(([, host]) => host);
  const own = [...line.matchAll(OWN_HOST_PATTERN)].map(([host]) => host);
  const network = [...line.matchAll(PRIVATE_NETWORK_PATTERN)].map(
    ([host]) => host,
  );
  return new Set(
    [...hosts, ...own, ...network].map((host) =>
      host.toLowerCase().replace(/\.+$/, ""),
    ),
  );
}
