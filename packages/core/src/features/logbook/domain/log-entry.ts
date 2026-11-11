/** Types for log-entry. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/parts.js";
import { ValidationError } from "../../../shared/errors.js";

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

export class LogEntryValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "LogEntryValidationError";
  }
}

