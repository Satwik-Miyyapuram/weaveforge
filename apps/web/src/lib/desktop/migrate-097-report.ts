/**
 * Reads the 0.9.7 migration report (`report-<device id>.json`) into what the upgrade
 * screen shows: per-kind counts, conflict copies, missing rows and the backup.
 * Pure: no bridge or DOM access, so the screen can be tested with plain data.
 */

export type Migrate097ReportState = "verified" | "incomplete";

export type Migrate097RemovalState = "removing" | "removed";

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
  /** This device's removal state from `report.removals`, when one is recorded. */
  removal: Migrate097RemovalState | null;
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

const KNOWN_TOP_STATES: readonly unknown[] = ["verified", "incomplete", "removing", "removed"];

function emptySummary(removal: Migrate097RemovalState | null): MigrationSummary {
  return {
    state: "incomplete",
    removal,
    backup: null,
    kinds: [],
    conflicts: [],
    missing: [],
    blobs: { db: 0, verified: 0 },
  };
}

function removalOf(raw: Obj, ownDeviceId: string): Migrate097RemovalState | null {
  const removals = isObj(raw.removals) ? raw.removals : {};
  const own = removals[ownDeviceId];
  const state = isObj(own) ? own.state : undefined;
  return state === "removing" || state === "removed" ? state : null;
}

/**
 * Summary of a parsed report for this device, or null when the value is not a
 * report with a known top-level state. Only the latest run from `ownDeviceId`
 * is judged: it is "verified" only when nothing is missing, every kind has
 * db == files and blobs db == verified. A device with no run of its own, or an
 * empty `ownDeviceId`, is "incomplete" with no kinds, rows or backup, whatever
 * the top-level state says. The device's removal state, when recorded, is
 * added either way.
 */
export function summarizeMigrationReport(raw: unknown, ownDeviceId: string): MigrationSummary | null {
  if (!isObj(raw) || !KNOWN_TOP_STATES.includes(raw.state)) return null;
  if (!ownDeviceId) return emptySummary(null);
  const removal = removalOf(raw, ownDeviceId);
  const runs = Array.isArray(raw.runs) ? raw.runs.filter(isObj) : [];
  const last = runs.filter((r) => r.deviceId === ownDeviceId).at(-1);
  if (!last) return emptySummary(removal);
  const kinds = kindRows(last.kinds);
  const blobsRaw = isObj(last.blobs) ? last.blobs : {};
  const blobs = { db: num(blobsRaw.db), verified: num(blobsRaw.verified) };
  const missing = missingRows(last.missing);
  const verified = missing.length === 0 && kinds.every((k) => k.db === k.files) && blobs.db === blobs.verified;
  return {
    state: verified ? "verified" : "incomplete",
    removal,
    backup: typeof last.backup === "string" ? last.backup : null,
    kinds,
    conflicts: kinds.flatMap((k) => k.conflicts),
    missing,
    blobs,
  };
}
