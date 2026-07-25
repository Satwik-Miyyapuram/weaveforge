/**
 * Repository contract for log entries.
 *
 * Defined in the domain layer (Dependency Inversion): application code depends
 * on this interface; infrastructure provides Supabase / in-memory / SQLite
 * implementations. Any implementation must be substitutable (Liskov) and is
 * verified by the shared contract test suite.
 */

import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type { LogEntry, LogEntryFilter } from "./log-entry.js";

export interface ILogEntryRepository
  extends IReadableRepository<LogEntry, LogEntryFilter>,
    IWritableRepository<LogEntry> {}
