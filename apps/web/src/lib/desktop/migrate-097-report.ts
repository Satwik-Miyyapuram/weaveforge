/**
 * Reads the 0.9.7 migration report (`report.json`) into what the upgrade
 * screen shows: per-kind counts, conflict copies, missing rows and the backup.
 * Pure: no bridge or DOM access, so the screen can be tested with plain data.
 */

export type Migrate097ReportState = "verified" | "incomplete";

export interface MigrationKindSummary {
  kind: string;
  db: number;
  files: number;
  written: number;
  conflicts: string[];
}

export interface MigrationMissingRow {
  kind: string;
  id: string;
  reason: string;
}

export interface MigrationSummary {
  state: Migrate097ReportState;
  backup: string | null;
  kinds: MigrationKindSummary[];
  /** Every conflict copy across the kinds, in report order. */
  conflicts: string[];
  missing: MigrationMissingRow[];
  blobs: { db: number; verified: number };
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function kindRows(kinds: unknown): MigrationKindSummary[] {
  if (!isObj(kinds)) return [];
  return Object.entries(kinds).map(([kind, row]) => {
    const r = isObj(row) ? row : {};
    return { kind, db: num(r.db), files: num(r.files), written: num(r.written), conflicts: strings(r.conflicts) };
  });
}

function missingRows(missing: unknown): MigrationMissingRow[] {
  if (!Array.isArray(missing)) return [];
  return missing.filter(isObj).map((m) => ({
    kind: typeof m.kind === "string" ? m.kind : "",
    id: typeof m.id === "string" ? m.id : "",
    reason: typeof m.reason === "string" ? m.reason : "",
  }));
}

/**
 * Summary of a parsed report, or null when the value is not a report with a
 * known state. Only the latest run is summarised; earlier runs are history.
 */
export function summarizeMigrationReport(raw: unknown): MigrationSummary | null {
  if (!isObj(raw)) return null;
  if (raw.state !== "verified" && raw.state !== "incomplete") return null;
  const runs = Array.isArray(raw.runs) ? raw.runs.filter(isObj) : [];
  const last: Record<string, unknown> = runs.at(-1) ?? {};
  const kinds = kindRows(last.kinds);
  const blobs = isObj(last.blobs) ? last.blobs : {};
  return {
    state: raw.state,
    backup: typeof raw.backup === "string" ? raw.backup : null,
    kinds,
    conflicts: kinds.flatMap((k) => k.conflicts),
    missing: missingRows(last.missing),
    blobs: { db: num(blobs.db), verified: num(blobs.verified) },
  };
}
