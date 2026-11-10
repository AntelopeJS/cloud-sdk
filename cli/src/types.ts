import type {
  Prompter,
  PrompterOptions,
  TaskList,
  Ui,
} from "@antelopejs/core/cli";

export interface ServicePath {
  path: string;
  /**
   * The Dockerfile the service builds with, relative to its path: uploaded
   * as the archive's `Dockerfile`, so two services can build one folder
   * differently.
   */
  dockerfile?: string;
}

export interface ProjectConfig {
  workspace: string;
  project: string;
  services: Record<string, ServicePath>;
}

export interface Credentials {
  apiUrl: string;
  consoleUrl: string;
  token: string;
  workspace: string;
}

export interface GlobalOptions {
  apiUrl?: string;
  json?: boolean;
  lang?: string;
  yes?: boolean;
  /** False with `--no-browser`: links are printed, never opened. */
  browser?: boolean;
}

/** Options of `deploy` that only matter when it creates the project. */
export interface DeployOptions {
  project?: string;
  region?: string;
  port?: string;
  /** Minutes to follow one service's deployment before giving up. */
  timeout?: string;
}

export interface LogsOptions {
  follow?: boolean;
}

export interface LinkOptions {
  service: string[];
  dockerfile: string[];
}

export interface Runtime {
  cwd: string;
  configHome: string;
  /**
   * Results on stdout, feedback on stderr: the output module of
   * `@antelopejs/core/cli`, or one on in-memory streams in tests.
   */
  ui: Ui;
  /** Progress of long work, drawn above everything else on a terminal. */
  tasks: TaskList;
  /**
   * Whether a person can answer a prompt and look at a browser: stdin and
   * stderr are terminals and the run is not in CI.
   */
  isInteractive: boolean;
  /**
   * Whether running tasks are animated on stderr. Without it — CI, pipes,
   * `--verbose`, `--quiet` — a long phase is said to be still running from
   * time to time instead.
   */
  hasLiveProgress: boolean;
  /** The prompter of one command, answering from flags first. */
  prompter(options: PrompterOptions): Prompter;
  open(url: string): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
  /** Milliseconds since the epoch, injectable to test elapsed times. */
  now(): number;
  /**
   * Calls `listener` on Ctrl+C before the process exits; returns the function
   * that removes it.
   */
  onInterrupt(listener: () => void): () => void;
}
