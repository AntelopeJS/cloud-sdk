#!/usr/bin/env node
import {
  FAILURE_EXIT_CODE,
  formatUsageErrors,
  getProcessUi,
  isVerboseRun,
  runWithErrorBoundary,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "@antelopejs/core/cli";
import type { Command } from "commander";
import { createCloudCommand } from "./command.js";
import {
  describeFailure,
  errorCode,
  errorStatus,
  problemOfAny,
  problemSentence,
} from "./error-messages.js";
import { isNumber, isRecord, isString } from "./guards.js";
import { ENVIRONMENT_TOPIC, formatEnvironmentHelp } from "./help.js";
import type { GlobalOptions } from "./types.js";

interface JsonError {
  code: string;
  message: string;
  status: number | null;
}

interface ExitingError {
  code?: string;
  exitCode?: number;
}

/** What Commander and the core errors say about how the run exits. */
function exitingOf(cause: unknown): ExitingError {
  if (!isRecord(cause)) return {};
  return {
    code: isString(cause.code) ? cause.code : undefined,
    exitCode: isNumber(cause.exitCode) ? cause.exitCode : undefined,
  };
}

const OUTPUT_VERSION = 1;
const COMMANDER_PREFIX = "commander.";
const JSON_FLAGS = ["--json", "-j"];
const LANG_FLAG = "--lang";
const LANG_ASSIGNMENT = `${LANG_FLAG}=`;
const VERBOSE_FLAG = "--verbose";
/** Only this spelling takes channels, as in `ajs`: `--verbose=api`. */
const VERBOSE_ASSIGNMENT = `${VERBOSE_FLAG}=`;
const ALL_CHANNELS = "*";
const END_OF_OPTIONS = "--";
/** Flags that change how the CLI speaks, not what it does. */
const OUTPUT_FLAGS = ["--no-color", "-q", "--quiet", ...JSON_FLAGS];
/** Commander's exits that are answers, not failures: help and version. */
const ANSWER_CODES = new Set([
  "commander.help",
  "commander.helpDisplayed",
  "commander.version",
]);

/** The options of the command line, without the operands after `--`. */
function optionArguments(args: string[]): string[] {
  const end = args.indexOf(END_OF_OPTIONS);
  return end === -1 ? args : args.slice(0, end);
}

/**
 * Spells a bare `--verbose` as `--verbose=*`, so that it never takes the
 * next argument as its channels: `ajs-cloud --verbose deploy` runs `deploy`.
 */
function normalizeVerboseArguments(args: string[]): string[] {
  const optionCount = optionArguments(args).length;
  return args.map((arg, index) =>
    index < optionCount && arg === VERBOSE_FLAG
      ? `${VERBOSE_ASSIGNMENT}${ALL_CHANNELS}`
      : arg,
  );
}

/** The arguments, the flags that only change the output aside. */
function ownArguments(args: string[]): string[] {
  return args.filter(
    (arg) => !OUTPUT_FLAGS.includes(arg) && !arg.startsWith(VERBOSE_ASSIGNMENT),
  );
}

function isInvocation(args: string[], rest: string[]): boolean {
  const own = ownArguments(args);
  return own.length === rest.length && own.every((arg, i) => arg === rest[i]);
}

/** The language asked for, read before Commander could parse it. */
function requestedLanguage(args: string[]): string | undefined {
  const index = args.indexOf(LANG_FLAG);
  if (index >= 0) return args[index + 1];
  return args
    .find((value) => value.startsWith(LANG_ASSIGNMENT))
    ?.slice(LANG_ASSIGNMENT.length);
}

/**
 * The name in `help <name>` when it is neither a command nor a topic.
 * Commander would answer it with the whole root help, as an error.
 */
function unknownHelpSubject(
  program: Command,
  args: string[],
): string | undefined {
  const [first, subject, ...rest] = ownArguments(args);
  if (first !== "help" || subject === undefined || rest.length > 0)
    return undefined;
  const known = [
    ...program.commands.map((command) => command.name()),
    "help",
    ENVIRONMENT_TOPIC,
  ];
  return known.includes(subject) ? undefined : subject;
}

/**
 * Ends the run quietly once whoever reads stdout stops reading, as `head`
 * does in `ajs-cloud logs web | head`.
 */
function exitOnBrokenPipe(): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
    process.exit(SUCCESS_EXIT_CODE);
  });
}

const args = normalizeVerboseArguments(process.argv.slice(2));
const isJson = optionArguments(args).some((arg) => JSON_FLAGS.includes(arg));
const program = createCloudCommand().name("ajs-cloud");

function language(): string | undefined {
  return (
    program.opts<GlobalOptions>().lang ??
    requestedLanguage(args) ??
    process.env.LANG
  );
}

/**
 * With `--json`, a failure is one JSON record on stderr, so that a script
 * reads it the way it reads the results: by its stable code.
 */
function reportJsonFailure(cause: unknown): void {
  const problem = problemOfAny(cause, language());
  const value: JsonError = {
    code: errorCode(cause),
    message: problemSentence(problem),
    status: errorStatus(cause),
  };
  process.stderr.write(
    `${JSON.stringify({ version: OUTPUT_VERSION, type: "error", error: value })}\n`,
  );
  process.exitCode = isUsageError(cause)
    ? USAGE_EXIT_CODE
    : (exitingOf(cause).exitCode ?? problem.exitCode ?? FAILURE_EXIT_CODE);
}

/** A Commander error: the command line is wrong, nothing was attempted. */
function isUsageError(cause: unknown): boolean {
  return exitingOf(cause).code?.startsWith(COMMANDER_PREFIX) ?? false;
}

function isAnswer(cause: unknown): boolean {
  return ANSWER_CODES.has(exitingOf(cause).code ?? "");
}

/**
 * With `--json`, Commander's own errors keep their code for the JSON record
 * (`commander.unknownCommand`); otherwise they are told like any problem.
 */
function configureUsageErrors(command: Command): void {
  if (!isJson) {
    formatUsageErrors(command);
    return;
  }
  command.exitOverride().configureOutput({ outputError: () => undefined });
  command.commands.forEach(configureUsageErrors);
}

async function main(): Promise<void> {
  exitOnBrokenPipe();
  configureUsageErrors(program);
  if (isInvocation(args, [])) {
    program.outputHelp();
    return;
  }
  if (isInvocation(args, ["help", ENVIRONMENT_TOPIC])) {
    getProcessUi().value(formatEnvironmentHelp());
    return;
  }
  const helpSubject = unknownHelpSubject(program, args);
  if (helpSubject !== undefined) {
    program.error(`error: unknown command '${helpSubject}'`, {
      code: "commander.unknownCommand",
    });
  }
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (error) {
    if (!isJson || isAnswer(error)) throw error;
    reportJsonFailure(error);
  }
}

await runWithErrorBoundary(main, {
  verbose: isVerboseRun(),
  translate: (error) => describeFailure(error, language()),
});
