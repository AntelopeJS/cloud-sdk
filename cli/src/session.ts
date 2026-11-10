import type { CloudApi } from "@antelopejs/cloud-sdk";
import { cloudApi } from "./api.js";
import {
  findProjectRoot,
  readCredentials,
  readProjectConfig,
} from "./config.js";
import { CliError } from "./errors.js";
import type { Credentials, GlobalOptions, Runtime } from "./types.js";
import { normalizedApiUrl } from "./validation.js";

/** A signed-in command working in a linked folder. */
export interface LinkedContext {
  root: string;
  config: Awaited<ReturnType<typeof readProjectConfig>>;
  credentials: Credentials;
  api: CloudApi;
}

/**
 * The saved session, refused when an `--api-url` override points elsewhere:
 * the token is never sent to an endpoint it was not issued by.
 */
export async function session(
  runtime: Runtime,
  options: GlobalOptions,
): Promise<Credentials> {
  const credentials = await readCredentials(runtime.configHome);
  if (
    options.apiUrl !== undefined &&
    normalizedApiUrl(options.apiUrl) !== normalizedApiUrl(credentials.apiUrl)
  ) {
    throw new CliError("api_url_mismatch");
  }
  return credentials;
}

/**
 * The session, then the folder's link: a signed-out user is told to log in
 * before being told the folder is not linked, since that is the first step.
 */
export async function linkedContext(
  runtime: Runtime,
  options: GlobalOptions,
  signedIn?: Credentials,
): Promise<LinkedContext> {
  const credentials = signedIn ?? (await session(runtime, options));
  const root = await findProjectRoot(runtime.cwd);
  const config = await readProjectConfig(root);
  if (credentials.workspace !== config.workspace)
    throw new CliError("workspace_mismatch");
  return { root, config, credentials, api: cloudApi(credentials) };
}
