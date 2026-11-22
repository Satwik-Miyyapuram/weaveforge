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

/** The folder every migration report file lives in. */
export const REPORT_DIR = ".weaveforge/migration-0.9.7";

/** The legacy shared report. Every reader reads it; no device writes it again. */
export const REPORT_PATH = `${REPORT_DIR}/report.json`;

/** This device's own report: the only report file this device writes. Other devices' files are never rewritten. */
export function ownReportPath(deviceId: string): string {
  return `${REPORT_DIR}/report-${deviceId}.json`;
}

/** A report file: report.json, report-<id>.json, or a sync copy of either. The .bad files kept aside do not match. */
function isReportFileName(path: string): boolean {
  const name = path.slice(REPORT_DIR.length + 1);
  return path.startsWith(`${REPORT_DIR}/`) && !name.includes("/") && name.startsWith("report") && name.endsWith(".json");
}

export type MigrationState = "verified" | "incomplete" | "none";

/** Where the export landed: the browser OPFS repos, or a desktop folder. */
export type MigrationTarget = "opfs" | "folder";

export type KindCount = { db: number; files: number; written: number; conflicts: string[]; trash: number };

/** `value` is set only on a conflict: the DB value the file kept out, so the report loses no data. */
export type MissingRow = { kind: string; id: string; reason: string; value?: unknown };

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
  /** The pre-migration dump this device's run made (desktop). Null on web. Each device keeps its own. */
  backup?: string | null;
  /** Conflict copies written or reused this run: the DB version kept beside a file that differed. */
  conflicts?: string[];
  /** Paths this device's previous run wrote and this run did not. Kept on disk, never deleted. */
  orphans?: string[];
  /** Every path this run wrote, reused or kept, with the sha256 of its content. The next run of this device reads it. */
  outputs?: Record<string, string>;
};

export type MigrationReport = {
  version: 1;
  state: MigrationState;
  /** The first non-null backup written to this report, kept for older readers. A later run never replaces it. */
  backup: string | null;
  /** ISO time the export verified. Absent unless state is "verified". */
  verifiedAt?: string;
  /** This install's id from the desktop backup. Absent on web and Android (no backup, no id). */
  deviceId?: string;
  /** "folder" for desktop, "opfs" for the browser. Absent on reports written before this field. */
  target?: MigrationTarget;
  /** Providers whose secret stayed on the server, so the user reconnects them on desktop. Names only. */
  reconnectProviders?: string[];
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
 * Every run in every report file: the legacy report.json and each device's report-<id>.json, sync copies
 * included. Null when the listing fails or any report file is unreadable, so the caller fails closed.
 * An absent or run-less file contributes nothing. Never throws.
 */
export async function readMigrationRuns(fs: Pick<FileSink, "list" | "readText">): Promise<RunReport[] | null> {
  let names: string[];
  try {
    names = await fs.list();
  } catch {
    return null;
  }
  const runs: RunReport[] = [];
  for (const path of names.filter(isReportFileName)) {
    const fileRuns = await readReportFile(fs, path);
    if (fileRuns === null) return null;
    runs.push(...fileRuns);
  }
  return runs;
}

/** The runs of one report file, or null when it cannot be read as a report. Never throws. */
async function readReportFile(fs: Pick<FileSink, "readText">, path: string): Promise<RunReport[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readText(path));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { state, runs } = parsed as { state?: unknown; runs?: unknown };
  if (!(state === "verified" || state === "incomplete" || state === "none")) return null;
  if (!Array.isArray(runs) || !runs.every(isRunReport)) return null;
  return runs;
}

/**
 * The file name of the first report file that cannot be read, for the refusal message. "" when the folder cannot
 * be listed (no file to name), null when every report file reads.
 */
export async function unreadableReportName(fs: Pick<FileSink, "list" | "readText">): Promise<string | null> {
  let names: string[];
  try {
    names = await fs.list();
  } catch {
    return "";
  }
  for (const path of names.filter(isReportFileName)) {
    if ((await readReportFile(fs, path)) === null) return path.split("/").pop() ?? path;
  }
  return null;
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
export function runIsClean(run: RunReport): boolean {
  return (
    MIGRATION_KINDS.every((kind) => Object.prototype.hasOwnProperty.call(run.kinds, kind)) &&
    run.missing.length === 0 &&
    (run.conflicts ?? []).length === 0 &&
    run.blobs.db === run.blobs.verified &&
    Object.values(run.kinds).every((k) => k.db === k.files && k.conflicts.length === 0)
  );
}

/**
 * The one check for "the OPFS repos hold a clean verified export for this device". A report counts as verified
 * only when both checks pass: isVerifiedOpfsReport (this device's own newest run is an opfs run, and every
 * device's newest run is verified and clean with only known kinds) and unverifiedDevices (every device's newest
 * run is clean). Absent, corrupt, incomplete, folder-only or id-less reports are false.
 */
export async function browserReportVerified(fs: Pick<FileSink, "list" | "readText">, ownDeviceId?: string): Promise<boolean> {
  const runs = await readMigrationRuns(fs);
  if (!runs) return false;
  const report = { runs };
  if (!isVerifiedOpfsReport(report, ownDeviceId)) return false;
  return unverifiedDevices(report).length === 0;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<string>(MIGRATION_KINDS);

/** A run lists no missing row and every kind it names is a known migration kind. */
function runPassesKnownKinds(run: object): boolean {
  const { missing, kinds } = run as { missing?: unknown; kinds?: unknown };
  if (!Array.isArray(missing) || missing.length !== 0) return false;
  if (typeof kinds !== "object" || kinds === null || Array.isArray(kinds)) return false;
  return Object.keys(kinds).every((kind) => KNOWN_KINDS.has(kind));
}

/**
 * The one validator for "the OPFS repos hold a clean verified export for this device". Used for runs read
 * from disk, so a hand-edited file is checked the same way. Every device's newest run must be verified and
 * clean; this device's own newest run must also have target opfs. Never throws; anything malformed is false.
 */
export function isVerifiedOpfsReport(report: unknown, ownDeviceId?: string): boolean {
  // No install id means no own run: a run without an id must never unlock this device.
  if (ownDeviceId === undefined) return false;
  if (typeof report !== "object" || report === null) return false;
  const runs = (report as { runs?: unknown }).runs;
  if (!Array.isArray(runs) || !runs.every((run) => typeof run === "object" && run !== null)) return false;
  const newest = latestRunPerDevice(runs as RunReport[]);
  const own = newest.find((run) => run.deviceId === ownDeviceId);
  if (own === undefined || own.target !== "opfs") return false;
  return newest.every((run) => run.state === "verified" && runPassesKnownKinds(run));
}

/**
 * The newest run of each device: the later start time wins. On a tie, any run that is not verified wins
 * (fail closed), whatever the file order. A run with no deviceId cannot be attributed, so every such run
 * is kept: each one must be clean.
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
    const failsClosed = (r: RunReport) => (r.state === "verified" ? 0 : 1);
    if (!seen || run.startedAt > seen.startedAt || (run.startedAt === seen.startedAt && failsClosed(run) > failsClosed(seen))) {
      latest.set(run.deviceId, run);
    }
  }
  return [...latest.values(), ...unattributed];
}

/**
 * Devices whose newest run is not clean, by deviceId ("" for a run with no id). The status UI names
 * these so the user can re-run the export on that device. Empty when every device's newest run is clean.
 */
export function unverifiedDevices(report: Pick<MigrationReport, "runs">): string[] {
  return latestRunPerDevice(report.runs)
    .filter((run) => !runIsClean(run))
    .map((run) => run.deviceId ?? "");
}
