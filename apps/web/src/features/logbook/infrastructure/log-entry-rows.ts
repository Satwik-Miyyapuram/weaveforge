import { type LogEntry, type LogKind, type LogLink } from "@weaveforge/core";
/**
 * How log entry rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers, which talk to the same table through
 * different clients. The Supabase repository layers the encrypted-row columns
 * on top of this; Postgres does not have them.
 */

export interface LogEntryRow {
  id: string;
  entry_date: string;
  kind: LogKind;
  body: string;
  links: LogLink[] | null;
  created_at: string;
}

export function logEntryToDomain(row: LogEntryRow): LogEntry {
  return {
    id: row.id,
    entryDate: row.entry_date,
    kind: row.kind,
    body: row.body,
    links: row.links ?? [],
    createdAt: row.created_at,
  };
}

export function logEntryToRow(e: LogEntry): Record<string, unknown> {
  return {
    id: e.id,
    entry_date: e.entryDate,
    kind: e.kind,
    body: e.body,
    links: e.links,
    created_at: e.createdAt,
  };
}
