/**
 * Log entry construction (Rust `log_entry`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/logbook/domain/log-entry.ts.
 */
import {
  createLogEntry as rawCreateLogEntry,
  logEntryInputError as rawLogEntryInputError,
} from "../pkg/wf_wasm.js";
import type { LogEntry, LogKind, NewLogEntryInput } from "./bindings.js";

export const LOG_KINDS: readonly LogKind[] = ["daily", "weekly"];

/** The validation message for log entry input, if it is invalid. */
export function logEntryInputError(input: NewLogEntryInput): string | undefined {
  return rawLogEntryInputError(input);
}

/**
 * Build a valid LogEntry from partial input, applying defaults and invariants.
 * The body is checked before the clock and id generator run, like the TS original.
 */
export function createLogEntry(
  input: NewLogEntryInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): LogEntry {
  const message = logEntryInputError(input);
  if (message) {
    const error = new Error(message);
    error.name = "LogEntryValidationError";
    throw error;
  }
  const now = deps.clock.nowIso();
  return rawCreateLogEntry(input, deps.ids.newId(), now) as LogEntry;
}
