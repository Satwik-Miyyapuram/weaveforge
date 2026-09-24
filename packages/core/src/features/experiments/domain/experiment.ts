/**
 * Experiments domain model — pure, no I/O. An Experiment is one tracked run,
 * pinned to a code state (repo / branch / commit) like a git entry, with config
 * and metrics. One reason to change: the rules of what an experiment *is* (SRP).
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { ValidationError } from "../../../shared/errors.js";

export type ExperimentStatus =
  | "planned"
  | "running"
  | "done"
  | "failed"
  | "abandoned";

export const EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  "planned",
  "running",
  "done",
  "failed",
  "abandoned",
];

export interface Experiment extends Identifiable {
  id: string;
  name: string;
  hypothesis?: string;
  status: ExperimentStatus;
  repoUrl?: string;
  commitSha?: string;
  branch?: string;
  runCommand?: string;
  /** Hyperparameters / dataset / seed. */
  config: Record<string, unknown>;
  /** {"val_loss": 0.118, "mig": 0.41, ...} */
  metrics: Record<string, unknown>;
  /** Links to checkpoints / plots (W&B, Storage, etc.). */
  artifacts: string[];
  resultNote?: string;
  startedAt?: string;
  /**
   * When the run reached a terminal status; absent while it has not.
   *
   * Invariant: `finishedAt` is present **iff** `status` is terminal. It is
   * enforced by {@link createExperiment} and by {@link statusPatchForExperiment}
   * rather than by the type. Making it unrepresentable would mean splitting
   * `Experiment` into a discriminated union of open and closed runs, which
   * touches every construction site, every repository row mapper, and every
   * consumer reading `experiment.finishedAt` — a refactor of its own rather than
   * a drive-by fix. What the type *can* do is refuse the transition that used to
   * leave a reopened run claiming an end time it no longer has.
   */
  finishedAt?: string;
  /** Paper this run tests/implements. */
  relatedPaper?: string;
  createdAt: string;
}

export interface NewExperimentInput {
  name: string;
  hypothesis?: string;
  status?: ExperimentStatus;
  repoUrl?: string;
  commitSha?: string;
  branch?: string;
  runCommand?: string;
  config?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  artifacts?: string[];
  resultNote?: string;
  relatedPaper?: string;
}

export interface ExperimentFilter {
  status?: ExperimentStatus;
  /** Case-insensitive substring match against name. */
  nameContains?: string;
  relatedPaper?: string;
}

export class ExperimentValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentValidationError";
  }
}

export function createExperiment(
  input: NewExperimentInput,
  deps: { clock: Clock; ids: IdGenerator },
): Experiment {
  const name = input.name?.trim();
  if (!name) throw new ExperimentValidationError("Experiment name is required.");
  const now = deps.clock.nowIso();
  const status = input.status ?? "planned";
  return {
    id: deps.ids.newId(),
    name,
    hypothesis: input.hypothesis,
    status,
    repoUrl: input.repoUrl,
    commitSha: input.commitSha?.trim(),
    branch: input.branch?.trim(),
    runCommand: input.runCommand,
    config: input.config ?? {},
    metrics: input.metrics ?? {},
    artifacts: input.artifacts ?? [],
    resultNote: input.resultNote,
    startedAt: status === "running" ? now : undefined,
    // A run created already-finished (an import of a past run) gets its end
    // stamp here; without this the row would say "done" and carry no time,
    // which is the illegal state the field's invariant forbids.
    finishedAt: TERMINAL_EXPERIMENT_STATUSES.includes(status) ? now : undefined,
    relatedPaper: input.relatedPaper,
    createdAt: now,
  };
}

/** The statuses that end a run. Kept here so `finishedAt` has one definition. */
export const TERMINAL_EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  "done",
  "failed",
  "abandoned",
];

/**
 * The status-related fields for a run moving to `status` at `now`.
 *
 * One function rather than the same three ternaries copied into every caller,
 * because the transition has an invariant to keep: `finishedAt` is set exactly
 * when the run is terminal. Entering a terminal status stamps it; *leaving* one
 * clears it. Clearing is the half that used to be missing — a run moved from
 * `failed` back to `running` kept the old end time, so the dashboard showed a
 * live run with a finish timestamp, and any reader that prefers `finishedAt`
 * over `startedAt` (the search index does) dated the run to a finish that had
 * been undone.
 */
export function statusPatchForExperiment(
  experiment: Experiment,
  status: ExperimentStatus,
  now: string,
): Pick<Experiment, "status" | "startedAt" | "finishedAt"> {
  const terminal = TERMINAL_EXPERIMENT_STATUSES.includes(status);
  return {
    status,
    // First start is remembered; a later restart does not rewrite history.
    startedAt: status === "running" && !experiment.startedAt ? now : experiment.startedAt,
    // Stamped on the way in — the behaviour this replaces — and removed on the
    // way out, which is the part that was missing.
    finishedAt: terminal ? now : undefined,
  };
}

/** Short display form of a commit SHA. */
export function shortSha(sha?: string): string | undefined {
  return sha ? sha.trim().slice(0, 7) : undefined;
}

/** Running experiments with no finish and no activity this long are treated as dead. */
export const STALE_RUNNING_MS = 2 * 60 * 1000;

export function experimentActivityAt(exp: Experiment): number {
  const raw = exp.startedAt ?? exp.createdAt;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/** SDK / process died without updating status — still marked running in the DB. */
export function isStaleRunningExperiment(
  exp: Experiment,
  nowMs: number = Date.now(),
  staleMs: number = STALE_RUNNING_MS,
  lastMetricAtMs?: number,
): boolean {
  if (exp.status !== "running") return false;
  const activity = Math.max(experimentActivityAt(exp), lastMetricAtMs ?? 0);
  if (!activity) return false;
  return nowMs - activity >= staleMs;
}

/** Format a numeric metric value for tables and chart axes (name-agnostic). */
export function formatMetricValue(_metric: string, value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-4)) return value.toExponential(2);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(3);
  if (abs >= 0.01) return value.toFixed(4);
  return value.toExponential(2);
}

/**
 * One metric's value as text, for a chip or a table cell.
 *
 * Here rather than in the web app because it is the *general* case of
 * {@link formatMetricValue}: the same rule for every surface that shows a metric
 * value, and no React in sight, so it can be tested without a DOM — the version
 * of this that lived in `metric-chart.tsx` could not be, because importing that
 * module pulls in uPlot's stylesheet.
 *
 * A number (or a numeric string) goes through `formatMetricValue`, which is what
 * gives the chips their consistent precision. Anything else is *shown*, not
 * stringified blindly — and that distinction is a bug that shipped: the fallback
 * was `String(value ?? "—")`, and `String` on any object produces the literal
 * `[object Object]`, which is what a run whose metric was an object displayed on
 * its experiment page. `Number(anObject)` is always `NaN`, so every non-numeric
 * value reached that fallback; that is why the symptom was this exact text
 * rather than a blank or a crash.
 *
 * An object is therefore shown as compact JSON, a boolean is spelled (it used to
 * render as `0.00000`, because `Number(false)` is a finite 0 — a different claim
 * from `false`), and a value that cannot be serialised at all, such as a cycle,
 * degrades to "—" rather than throwing inside a render.
 */
export function formatMetricCell(_metric: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isFinite(n)) return formatMetricValue(_metric, n);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  try {
    const json = JSON.stringify(value);
    // `undefined` from a function, a symbol, or an array/object holding only
    // those: JSON has no representation, and "—" is the honest answer.
    return json === undefined ? "—" : json;
  } catch {
    // A cycle, or a `toJSON` that threw. The cell is not worth failing a render.
    return "—";
  }
}
