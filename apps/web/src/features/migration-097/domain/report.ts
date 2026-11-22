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

export type KindCount = { db: number; files: number; written: number; conflicts: string[] };

export type MissingRow = { kind: string; id: string; reason: string };

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  sources: string[];
  kinds: Record<string, KindCount>;
  blobs: { db: number; verified: number };
  missing: MissingRow[];
  errors: string[];
};

export type MigrationReport = {
  version: 1;
  state: MigrationState;
  backup: null;
  runs: RunReport[];
};
