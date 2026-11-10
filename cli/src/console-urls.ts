/**
 * Console pages the CLI links to, as the console routes them: every page
 * takes its ids as query parameters, never as path segments.
 */
const PAGE_PATHS = {
  project: "/projects/project",
  service: "/projects/project/service",
  deployment: "/projects/project/deployment",
} as const;

export type ConsolePage = keyof typeof PAGE_PATHS;

/** Ids a console page is narrowed to; absent ones are left out. */
export type ConsoleTarget = {
  project: string;
  service?: string;
  deployment?: string;
};

/**
 * The absolute URL of a console page.
 *
 * @param consoleUrl Console origin saved at login
 * @param page Which page
 * @param target Project, and the service or deployment the page shows
 */
export function consoleUrl(
  consoleUrl: string,
  page: ConsolePage,
  target: ConsoleTarget,
): string {
  const url = new URL(PAGE_PATHS[page], consoleUrl);
  for (const [key, value] of Object.entries(target)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.href;
}
