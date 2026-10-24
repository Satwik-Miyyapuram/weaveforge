import type { LogEntry } from "@weaveforge/core";

import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

/**
 * Run a follow-up that must not fail the save it follows (a git push, a chat
 * post). A failure is logged for the app log rather than swallowed.
 */
export async function bestEffort(what: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    logToApp({ level: "warn", source: "logbook", message: `${what} failed`, detail: formatError(error) });
  }
}

/** The two stores a log entry is removed from. */
export interface LogEntryRemover {
  addLogEntry: { remove(id: string): Promise<unknown> };
  removeLog(entry: LogEntry): Promise<unknown>;
}

/**
 * Remove a log entry, then its git copy. Answers the error to show when the
 * entry itself could not be removed, or null. A failed git removal is logged:
 * the entry is gone either way.
 */
export async function removeLogEntry(logbook: LogEntryRemover, entry: LogEntry): Promise<string | null> {
  try {
    await logbook.addLogEntry.remove(entry.id);
  } catch (error) {
    return formatError(error);
  }
  await bestEffort("Removing the log from git", () => logbook.removeLog(entry));
  return null;
}
