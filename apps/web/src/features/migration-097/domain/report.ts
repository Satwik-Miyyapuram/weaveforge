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
  /** This run's own outcome. Set per run so a later run from another device cannot change it. Absent on older reports. */
  state?: MigrationState;
  /** Where this run exported to. Absent on older reports. */
  target?: MigrationTarget;
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
  const runsOk = runs.every((run) => typeof run === "object" && run !== null && Array.isArray((run as { missing?: unknown }).missing));
  return runsOk ? (parsed as MigrationReport) : null;
}

/**
 * True only when the OPFS repos hold a clean verified export for this device. `ownDeviceId` is this
 * install's stable id (the browser and Android keep one under .weaveforge/local/; desktop uses its
 * backup id). Without an id nothing is this device's own run, so the result is false.
 * Anything else (absent, corrupt, incomplete, folder-only) is false.
 */
export async function browserReportVerified(fs: Pick<FileSink, "readText">, ownDeviceId?: string): Promise<boolean> {
  return isVerifiedOpfsReport(await readMigrationReport(fs), ownDeviceId);
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<string>(MIGRATION_KINDS);

function deviceOf(run: object): string | undefined {
  const id = (run as { deviceId?: unknown }).deviceId;
  return typeof id === "string" ? id : undefined;
}

/** A run is clean when it lists no missing row and every kind it names is a known migration kind. */
function runIsClean(run: object): boolean {
  const { missing, kinds } = run as { missing?: unknown; kinds?: unknown };
  if (!Array.isArray(missing) || missing.length !== 0) return false;
  if (typeof kinds !== "object" || kinds === null || Array.isArray(kinds)) return false;
  return Object.keys(kinds).every((kind) => KNOWN_KINDS.has(kind));
}

/**
 * The one validator for "the OPFS repos hold a clean verified export for this device". Used for a
 * report read from disk, so a hand-edited file is checked the same way. Runs are grouped by deviceId
 * and each group's newest run is taken: writeReport appends a device's run last, so that is the last
 * entry. Every device's newest run must be verified and clean. This device's own newest run must
 * also have target opfs. The top-level state and target are the last writer's, so they are not read.
 * Never throws; anything malformed is false.
 */
export function isVerifiedOpfsReport(report: unknown, ownDeviceId?: string): boolean {
  // No install id means no own run: a run without an id must never unlock this device.
  if (ownDeviceId === undefined) return false;
  if (typeof report !== "object" || report === null) return false;
  const runs = (report as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return false;
  const newest = new Map<string | undefined, object>();
  for (const run of runs as unknown[]) {
    if (typeof run !== "object" || run === null) return false;
    newest.set(deviceOf(run), run);
  }
  const own = newest.get(ownDeviceId);
  if (own === undefined || (own as { target?: unknown }).target !== "opfs") return false;
  return [...newest.values()].every(
    (run) => (run as { state?: unknown }).state === "verified" && runIsClean(run),
  );
}
