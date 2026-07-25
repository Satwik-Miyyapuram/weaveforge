/**
 * Logbook domain model — pure, no I/O, no SDK imports.
 *
 * The `LogEntry` entity and its invariants live here. Persistence is someone
 * else's job (infrastructure). One reason to change: the rules of what a log
 * entry *is* (Single Responsibility).
 */

import type { Identifiable } from "../../../shared/repository.js";
import { isoDate, type Clock, type IdGenerator } from "../../../shared/clock.js";

export type LogKind = "daily" | "weekly";

export const LOG_KINDS: readonly LogKind[] = ["daily", "weekly"];

/** A reference from a log entry to another entity (experiment, paper, section). */
export interface LogLink {
  type: string;
  id: string;
}

export interface LogEntry extends Identifiable {
  id: string;
  /** Calendar date (yyyy-mm-dd) the entry is about. */
  entryDate: string;
  kind: LogKind;
  /** Markdown body. */
  body: string;
  /** References to experiments / papers / sections. */
  links: LogLink[];
  createdAt: string;
}

/** Fields accepted when creating a log entry; the rest are defaulted. */
export interface NewLogEntryInput {
  body: string;
  entryDate?: string;
  kind?: LogKind;
  links?: LogLink[];
}

export interface LogEntryFilter {
  kind?: LogKind;
  /** Inclusive lower bound on entryDate (yyyy-mm-dd). */
  dateFrom?: string;
  /** Inclusive upper bound on entryDate (yyyy-mm-dd). */
  dateTo?: string;
  /** Case-insensitive substring match against body. */
  bodyContains?: string;
}

export class LogEntryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogEntryValidationError";
  }
}

/**
 * Build a valid LogEntry from partial input, applying defaults and invariants.
 * Throwing here keeps invalid entities from ever reaching a repository.
 */
export function createLogEntry(
  input: NewLogEntryInput,
  deps: { clock: Clock; ids: IdGenerator },
): LogEntry {
  const body = input.body?.trim();
  if (!body) {
    throw new LogEntryValidationError("Log entry body is required.");
  }
  const now = deps.clock.nowIso();
  return {
    id: deps.ids.newId(),
    entryDate: input.entryDate ?? isoDate(now),
    kind: input.kind ?? "daily",
    body,
    links: input.links ?? [],
    createdAt: now,
  };
}
