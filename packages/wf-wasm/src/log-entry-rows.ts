/**
 * Log-entry row mapping (Rust `logbook::log_entry_row`). The rows are the `log_entries` columns;
 * both backend providers read and write the same table through the repositories in the web app.
 */
import {
  logEntryToDomain as rawLogEntryToDomain,
  logEntryToRow as rawLogEntryToRow,
} from "../pkg/wf_wasm.js";
import type { LogEntry, LogEntryRow, LogEntryWriteRow } from "./bindings.js";

export type { LogEntryRow, LogEntryWriteRow } from "./bindings.js";

/** A stored row as a domain entry. Null links become an empty list. */
export function logEntryToDomain(row: LogEntryRow): LogEntry {
  return rawLogEntryToDomain(row) as LogEntry;
}

/** A domain entry as the row it is written as. */
export function logEntryToRow(entry: LogEntry): LogEntryWriteRow {
  return rawLogEntryToRow(entry) as LogEntryWriteRow;
}
