import {
  applyHelpConventions,
  formatHelpItem,
  helpWidth,
  wrapText,
} from "@antelopejs/core/cli";
import type { Command } from "commander";

/** The help argument that names a topic rather than a command. */
export const ENVIRONMENT_TOPIC = "environment";

/** Every variable the CLI reads, in the order the topic lists them. */
const ENVIRONMENT_VARIABLES: ReadonlyArray<readonly [string, string]> = [
  ["ANTELOPE_CLOUD_URL", "Cloud API URL, same as --api-url"],
  [
    "XDG_CONFIG_HOME",
    "Where the session is saved, as antelopejs/cloud.json (default: ~/.config)",
  ],
  ["LANG", "Language of the messages when --lang is not given: fr or en"],
  ["NO_COLOR", "Same as --no-color"],
  ["FORCE_COLOR", "Colors even when the output is not a terminal"],
  ["ANTELOPEJS_VERBOSE", "Same as --verbose"],
  ["ANTELOPEJS_QUIET", "Same as -q, unless 0 or false"],
  ["CI", "Never prompts nor opens a browser, and never animates progress"],
];

/** Notes the `ajs-cloud help environment` topic prints after the variables. */
const ENVIRONMENT_NOTES = [
  "A folder is linked to its project by .antelope/cloud.json, which link and the first deploy write. Commit it, so that every clone deploys to the same project.",
];

/** A command's name and arguments, without Commander's `[options]`. */
function subcommandTerm(command: Command): string {
  const args = command.registeredArguments.map((argument) =>
    argument.required ? `<${argument.name()}>` : `[${argument.name()}]`,
  );
  return [command.name(), ...args].join(" ");
}

/**
 * The help of the core CLI on `program` and on every command under it,
 * commands listed by name and arguments.
 */
export function applyCloudHelp(program: Command): void {
  applyHelpConventions(program);
  const apply = (command: Command): void => {
    command.configureHelp({ ...command.configureHelp(), subcommandTerm });
    command.commands.forEach(apply);
  };
  apply(program);
}

/** The text of `ajs-cloud help environment`, wrapped to `width`. */
export function formatEnvironmentHelp(width: number = helpWidth()): string {
  const nameWidth = Math.max(
    ...ENVIRONMENT_VARIABLES.map(([name]) => name.length),
  );
  return [
    ...wrapText("Environment", width),
    "",
    ...ENVIRONMENT_VARIABLES.flatMap(([name, description]) =>
      formatHelpItem(name, nameWidth, description, width),
    ),
    ...ENVIRONMENT_NOTES.flatMap((note) => ["", ...wrapText(note, width)]),
  ].join("\n");
}
