import type {
  ComputeNeed,
  LogEntry,
  LogKind,
  LogLink,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
} from "@weaveforge/core";

/**
 * How supervision rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface MilestoneRow {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  target_date: string | null;
  dependencies: MilestoneDependency[] | null;
  compute: ComputeNeed[] | null;
  created_at: string;
}

export interface LogEntryRow {
  id: string;
  entry_date: string;
  kind: LogKind;
  body: string;
  links: LogLink[] | null;
  created_at: string;
}

export function milestoneToDomain(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    status: r.status,
    targetDate: r.target_date ?? undefined,
    dependencies: r.dependencies ?? [],
    compute: r.compute ?? [],
    createdAt: r.created_at,
  };
}

export function logToDomain(r: LogEntryRow): LogEntry {
  return {
    id: r.id,
    entryDate: r.entry_date,
    kind: r.kind,
    body: r.body,
    links: r.links ?? [],
    createdAt: r.created_at,
  };
}
