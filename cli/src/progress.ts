import type { SseEvent } from "@antelopejs/cloud-sdk";
import type { TaskHandle } from "@antelopejs/core/cli";
import { isNumber, isRecord, isString } from "./guards.js";
import { type MessageKey, message } from "./i18n.js";
import type { GlobalOptions, Runtime } from "./types.js";

const SECOND_MS = 1000;
const MINUTE_S = 60;
/** Without a terminal, how often a quiet phase is said to be still running. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** How often the elapsed time of the running task is refreshed. */
export const LABEL_INTERVAL_MS = 1_000;

/** Deployment statuses, and build phases, as the user reads them. */
const PHASE_LABELS = new Map<string, MessageKey>([
  ["uploading", "phaseUploading"],
  ["queued", "phaseQueued"],
  ["starting", "phaseBuilding"],
  ["running", "phaseBuilding"],
  ["building", "phaseBuilding"],
  ["checking", "phaseChecking"],
  ["switching", "phaseSwitching"],
  ["succeeded", "phaseSucceeded"],
  ["failed", "phaseFailed"],
  ["cancelled", "phaseCancelled"],
]);

/** Deployment statuses after which the platform does nothing more. */
export const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

interface ProgressData {
  status?: string;
  phase?: string;
  step?: string;
  position?: number;
}

/** What a progress event says, each field read only when it has its type. */
export function progressData(event: SseEvent): ProgressData {
  const data = event.data;
  if (!isRecord(data)) return {};
  return {
    status: isString(data.status) ? data.status : undefined,
    phase: isString(data.phase) ? data.phase : undefined,
    step: isString(data.step) ? data.step : undefined,
    position: isNumber(data.position) ? data.position : undefined,
  };
}

/** `1m 05s`, `42s`: short enough for a status line. */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(Math.round(milliseconds / SECOND_MS), 0);
  const minutes = Math.floor(seconds / MINUTE_S);
  const rest = seconds % MINUTE_S;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function phaseLabel(phase: string, lang?: string): string {
  const key = PHASE_LABELS.get(phase);
  return key ? message(key, lang) : phase;
}

/**
 * Build phases that do not move the deployment as they read. A finished
 * build only hands over to the rollout: the app is live when the deployment
 * status says so, minutes later, never when its image is ready. A failed or
 * cancelled build waits for the status that ends the deployment.
 */
const BUILD_PHASE_OVERRIDES = new Map<string, string | null>([
  ["queued", null],
  ["succeeded", "checking"],
  ["failed", null],
  ["cancelled", null],
]);

function buildPhaseOf(phase: string | undefined): string | null {
  if (phase === undefined) return null;
  const override = BUILD_PHASE_OVERRIDES.get(phase);
  return override === undefined ? phase : override;
}

/**
 * The phase an SSE progress event moves the deployment to, or null when it
 * only adds detail: `status-changed` and the `state` snapshot carry the
 * deployment status, `build-progress` the build's own phase.
 */
function phaseOf(event: SseEvent): string | null {
  const data = progressData(event);
  if (event.event === "build-progress") return buildPhaseOf(data.phase);
  return data.status ?? null;
}

/** Phases shown the same way are one stage: `starting` is `building`. */
function stageOf(phase: string): string {
  return PHASE_LABELS.get(phase) ?? phase;
}

/** What an event adds next to the phase: queue position or build step. */
function detailOf(event: SseEvent, lang?: string): string | null {
  const data = progressData(event);
  if (event.event === "queue-position" && data.position !== undefined)
    return `${message("queuePosition", lang)} ${data.position}`;
  if (event.event === "build-progress" && data.step) return data.step;
  return null;
}

/**
 * Tells a person where one service's deployment is: a line per phase with the
 * elapsed time, a task redrawn in place on a terminal, and — without one, in
 * CI logs — a plain "still building" line when a phase stays quiet.
 *
 * In `--json` mode it prints nothing: the caller emits the raw events.
 */
export class DeployProgress {
  private phase = "uploading";
  private detail = "";
  private lastLineAt: number;
  private timer: NodeJS.Timeout | null = null;
  private task: TaskHandle | null = null;

  constructor(
    private readonly runtime: Runtime,
    private readonly options: GlobalOptions,
    private readonly service: string,
    private readonly startedAt: number,
  ) {
    this.lastLineAt = startedAt;
  }

  /** Starts the task and the quiet-phase reminders. */
  start(): void {
    if (this.options.json) return;
    this.task = this.runtime.tasks.start(this.line(this.runtime.now()));
    this.announce();
    const interval = this.runtime.hasLiveProgress
      ? LABEL_INTERVAL_MS
      : HEARTBEAT_INTERVAL_MS;
    this.timer = setInterval(() => this.tick(), interval);
    this.timer.unref();
  }

  /** Reads one progress event; prints a line when the phase or detail moves. */
  update(event: SseEvent): void {
    const phase = phaseOf(event) ?? this.phase;
    const isNewStage = stageOf(phase) !== stageOf(this.phase);
    const detail = detailOf(event, this.options.lang);
    const nextDetail = detail ?? (isNewStage ? "" : this.detail);
    const hasChanged = isNewStage || nextDetail !== this.detail;
    this.phase = phase;
    this.detail = nextDetail;
    if (hasChanged) this.announce();
    else this.tick();
  }

  /**
   * Refreshes the task's elapsed time, or — without a live terminal — says
   * the phase is still running once it has been quiet for
   * {@link HEARTBEAT_INTERVAL_MS}.
   */
  tick(): void {
    if (this.options.json) return;
    const now = this.runtime.now();
    this.task?.update(this.line(now));
    if (this.runtime.hasLiveProgress) return;
    if (now - this.lastLineAt < HEARTBEAT_INTERVAL_MS) return;
    this.write(this.summary());
  }

  /** Stops the reminders and removes the task: its lines already told it. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.task?.dismiss();
    this.task = null;
  }

  /** Where the deployment was last seen: `web: still queued · 20m 00s`. */
  summary(): string {
    const still = message("stillRunning", this.options.lang);
    return `${this.service}: ${still} ${this.describe(this.runtime.now())}`;
  }

  private announce(): void {
    if (this.options.json) return;
    const now = this.runtime.now();
    this.task?.update(this.line(now));
    this.write(this.line(now));
  }

  private write(text: string): void {
    this.lastLineAt = this.runtime.now();
    this.runtime.ui.message("info", text);
  }

  private line(now: number): string {
    return `${this.service}: ${this.describe(now)}`;
  }

  private describe(now: number): string {
    const label = phaseLabel(this.phase, this.options.lang);
    const detail = this.detail ? ` (${this.detail})` : "";
    const elapsed = formatDuration(now - this.startedAt);
    return `${label}${detail}${this.runtime.ui.symbols.separator}${elapsed}`;
  }
}
