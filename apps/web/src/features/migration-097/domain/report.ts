import type { FileSink } from "./ports";

/** Kinds named by the 0.9.7 migration contract (LANES.md). */
export const MIGRATION_KINDS = [
  "notes",
  "papers",
  "tags",
  "paperFields",
  "paperFieldValues",
  "relations",
  "readingLists",
  "screening",
  "logEntries",
  "milestones",
  "experiments",
  "metrics",
  "reportSections",
  "annotations",
  "annotationPins",
  "libraryPins",
  "comments",
  "settings",
  "aiProposals",
  "blobs",
  "ink",
] as const;

export const REPORT_PATH = ".weaveforge/migration-0.9.7/report.json";

export type MigrationState = "verified" | "incomplete" | "none";

/** Where the export landed: the browser OPFS repos, or a desktop folder. */
export type MigrationTarget = "opfs" | "folder";

export type KindCount = { db: number; files: number; written: number; conflicts: string[]; trash: number };

export type MissingRow = { kind: string; id: string; reason: string };

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  sources: string[];
  kinds: Record<string, KindCount>;
  blobs: { db: number; verified: number };
  missing: MissingRow[];
  /** The device that made this run: one entry per device in report.json. Absent when no id is known. */
  deviceId?: string;
};

export type MigrationReport = {
  version: 1;
  state: MigrationState;
  backup: string | null;
  /** ISO time the export verified. Absent unless state is "verified". */
  verifiedAt?: string;
  /** This install's id from the desktop backup. Absent on web and Android (no backup, no id). */
  deviceId?: string;
  /** "folder" for desktop, "opfs" for the browser. Absent on reports written before this field. */
  target?: MigrationTarget;
  runs: RunReport[];
};

/**
 * True when the browser write gate must be on: the OPFS repos hold a verified export.
 * The zip download never sets this (it writes no report), and a folder export never does either.
 */
export function writesOff(report: Pick<MigrationReport, "state" | "target"> | null | undefined): boolean {
  return report?.state === "verified" && report.target === "opfs";
}

/**
 * Reads the report from the OPFS sink. Null when the file is absent, is not JSON, or is not a
 * report with a known state. Never throws, so a damaged report reads as no report.
 */
export async function readMigrationReport(fs: Pick<FileSink, "readText">): Promise<MigrationReport | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readText(REPORT_PATH));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { state, runs } = parsed as { state?: unknown; runs?: unknown };
  if (!(state === "verified" || state === "incomplete" || state === "none")) return null;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  return runs.every(isRunReport) ? (parsed as MigrationReport) : null;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isKindCount(v: unknown): v is KindCount {
  if (typeof v !== "object" || v === null) return false;
  const k = v as Partial<KindCount>;
  return isCount(k.db) && isCount(k.files) && isCount(k.written) && isCount(k.trash) && Array.isArray(k.conflicts);
}

/** A run with a missing list, per-kind counts and blob counts of the shape the export writes. */
function isRunReport(run: unknown): run is RunReport {
  if (typeof run !== "object" || run === null) return false;
  const r = run as Partial<RunReport>;
  if (!Array.isArray(r.missing)) return false;
  if (typeof r.kinds !== "object" || r.kinds === null || !Object.values(r.kinds).every(isKindCount)) return false;
  return typeof r.blobs === "object" && r.blobs !== null && isCount(r.blobs.db) && isCount(r.blobs.verified);
}

/** A run is clean when it covers every MIGRATION_KINDS key and nothing in it is missing, conflicting or unverified. */
function runIsClean(run: RunReport): boolean {
  return (
    MIGRATION_KINDS.every((kind) => Object.prototype.hasOwnProperty.call(run.kinds, kind)) &&
    run.missing.length === 0 &&
    run.blobs.db === run.blobs.verified &&
    Object.values(run.kinds).every((k) => k.db === k.files && k.conflicts.length === 0)
  );
}

/**
 * The newest run of each device, ISO start times order them. A run with no deviceId cannot be
 * attributed, so every such run is kept: each one must be clean.
 */
function latestRunPerDevice(runs: RunReport[]): RunReport[] {
  const latest = new Map<string, RunReport>();
  const unattributed: RunReport[] = [];
  for (const run of runs) {
    if (run.deviceId === undefined) {
      unattributed.push(run);
      continue;
    }
    const seen = latest.get(run.deviceId);
    if (!seen || run.startedAt > seen.startedAt) latest.set(run.deviceId, run);
  }
  return [...latest.values(), ...unattributed];
}

/**
 * Devices whose newest run is not clean, by deviceId ("" for a run with no id). The status UI names
 * these so the user can re-run the export on that device. Empty when every device's newest run is clean.
 */
export function unverifiedDevices(report: MigrationReport): string[] {
  return latestRunPerDevice(report.runs)
    .filter((run) => !runIsClean(run))
    .map((run) => run.deviceId ?? "");
}

/**
 * True only when the OPFS repos hold a clean verified export: state verified, target opfs, and the
 * newest run of every device is clean (every MIGRATION_KINDS key present, no row missing, every kind's
 * files matching its db rows with no conflicts, every blob verified). A failed run from any device
 * blocks. Anything else (absent, corrupt, incomplete, folder, zip) is false.
 */
export async function browserReportVerified(fs: Pick<FileSink, "readText">): Promise<boolean> {
  const report = await readMigrationReport(fs);
  if (!report || report.state !== "verified" || report.target !== "opfs") return false;
  return unverifiedDevices(report).length === 0;
}
