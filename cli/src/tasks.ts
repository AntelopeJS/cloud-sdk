import type { TaskHandle } from "@antelopejs/core/cli";
import type { GlobalOptions, Runtime } from "./types.js";

/** A piece of work shown as a task, and the line it ends on. */
export interface TaskWork<Result> {
  label: string;
  work: (task?: TaskHandle) => Promise<Result>;
  done: string | ((result: Result) => string);
}

/**
 * Runs `work` as a task of the task list: an animated line on a terminal, its
 * final line elsewhere. With `--json` only the records speak, so the work
 * runs without a task.
 */
export function withTask<Result>(
  runtime: Runtime,
  options: GlobalOptions,
  task: TaskWork<Result>,
): Promise<Result> {
  if (options.json) return task.work();
  return runtime.tasks.run(task.label, (handle) => task.work(handle), {
    done: task.done,
  });
}
