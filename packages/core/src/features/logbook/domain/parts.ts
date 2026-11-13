import { ValidationError } from "../../../shared/errors.js";
import type {
  Identifiable,
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";

// --- log-entry ---
/** Types for log-entry. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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

// --- log-entry-repository ---
/**
 * Repository contract for log entries.
 *
 * Defined in the domain layer (Dependency Inversion): application code depends
 * on this interface; infrastructure provides PostgREST / in-memory / SQLite
 * implementations. Any implementation must be substitutable (Liskov) and is
 * verified by the shared contract test suite.
 */
export interface ILogEntryRepository
  extends IReadableRepository<LogEntry, LogEntryFilter>,
    IWritableRepository<LogEntry> {}

/** Editable fields of an existing log entry (id/date/createdAt are preserved). */
export interface EditLogEntryInput {
  body: string;
  kind: LogKind;
}

/** Log entry operations (Rust `log_entries` repo arms; was AddLogEntryUseCase). */
export interface ILogEntryManager {
  add(input: NewLogEntryInput): Promise<LogEntry>;
  update(id: string, input: EditLogEntryInput): Promise<LogEntry>;
  remove(id: string): Promise<void>;
}
