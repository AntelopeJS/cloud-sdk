import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createPrompter,
  getProcessTasks,
  getProcessUi,
  isQuietRun,
  isVerboseRun,
} from "@antelopejs/core/cli";
import { CliError } from "./errors.js";
import type { Runtime } from "./types.js";

const INTERRUPTED_EXIT_CODE = 130;
const DUMB_TERMINAL = "dumb";
const DISABLED_FLAG_VALUES = ["", "0", "false"];
const BROWSER_COMMANDS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "open",
  win32: "explorer.exe",
};
const DEFAULT_BROWSER_COMMAND = "xdg-open";

function isEnabled(value: string | undefined): boolean {
  return (
    value !== undefined && !DISABLED_FLAG_VALUES.includes(value.toLowerCase())
  );
}

/** Whether someone can answer a prompt: as the core prompter decides it. */
function isInteractiveSession(): boolean {
  return (
    process.stdin.isTTY === true &&
    process.stderr.isTTY === true &&
    !isEnabled(process.env.CI)
  );
}

/** Whether the core task list animates: as it decides it itself. */
function hasLiveTasks(): boolean {
  return (
    process.stderr.isTTY === true &&
    process.env.TERM !== DUMB_TERMINAL &&
    !isEnabled(process.env.CI) &&
    !isVerboseRun() &&
    !isQuietRun()
  );
}

function onInterrupt(listener: () => void): () => void {
  const handler = () => {
    listener();
    process.exit(INTERRUPTED_EXIT_CODE);
  };
  process.once("SIGINT", handler);
  return () => process.off("SIGINT", handler);
}

function openUrl(url: string): Promise<void> {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new CliError("invalid_open_url", url);
  }
  const command = BROWSER_COMMANDS[process.platform] ?? DEFAULT_BROWSER_COMMAND;
  return new Promise((resolve, reject) => {
    const child = spawn(command, [target.href], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** The process streams, terminal and clock: what the commands run against. */
export function defaultRuntime(): Runtime {
  return {
    cwd: process.cwd(),
    configHome: process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    ui: getProcessUi(),
    tasks: getProcessTasks(),
    isInteractive: isInteractiveSession(),
    hasLiveProgress: hasLiveTasks(),
    prompter: createPrompter,
    open: openUrl,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
    onInterrupt,
  };
}
