import type { FileSink } from "./ports";

/** Kinds named by the 0.9.7 migration contract (LANES.md). */
export const MIGRATION_KINDS = [
  "notes",
  "papers",
  "tags",
  "paperFields",
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
  const state = (parsed as { state?: unknown } | null)?.state;
  return state === "verified" || state === "incomplete" || state === "none" ? (parsed as MigrationReport) : null;
}
