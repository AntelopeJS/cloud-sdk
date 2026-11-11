/** The name of the binary, as the texts of this package write a command. */
const BINARY = "ajs-cloud";
/** How the command is run through the `ajs` CLI, which loads it as a plugin. */
const PLUGIN_COMMAND = "ajs cloud";
/** How the command is run without installing anything. */
const NPX_COMMAND = "npx @antelopejs/cloud";
/** What npm sets `npm_command` to while `npx` or `npm exec` runs a package. */
const NPM_EXEC = "exec";

/**
 * How the person at the terminal runs this command: `ajs cloud`, or
 * `npx @antelopejs/cloud` when npx runs it. A hint must name a command that
 * person has: one who came through npx has neither `ajs` nor `ajs-cloud` on
 * the PATH, and a bare name passed to npx would fetch whatever package holds
 * that name on the registry.
 *
 * @param env Environment of the process
 */
export function commandName(env: NodeJS.ProcessEnv = process.env): string {
  return env.npm_command === NPM_EXEC ? NPX_COMMAND : PLUGIN_COMMAND;
}

/**
 * A text of this package with each command it names written the way the
 * person runs it. The texts themselves write `ajs-cloud`, the binary.
 *
 * @param text Hint, example or message
 * @param env Environment of the process
 */
export function asInvoked(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return text.replaceAll(BINARY, commandName(env));
}
