import { type HelpExample, withExamples } from "@antelopejs/core/cli";
import type { Command } from "commander";
import { asInvoked } from "./invocation.js";
import type { GlobalOptions } from "./types.js";
import { validateGlobalOptions } from "./validation.js";

/** Examples with each command written the way the person runs it. */
export function invoked(examples: HelpExample[]): HelpExample[] {
  return examples.map((example) => ({
    ...example,
    command: asInvoked(example.command),
  }));
}

export function withInvokedExamples(
  command: Command,
  examples: HelpExample[],
): ReturnType<typeof withExamples> {
  return withExamples(command, invoked(examples));
}

export function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

/**
 * Checks the global options, then loads the actions: `--help`, `--version`
 * and usage errors never load them.
 */
export async function actions(options: GlobalOptions) {
  validateGlobalOptions(options);
  return import("./actions.js");
}
