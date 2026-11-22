/**
 * Log entries as `logbook/YYYY/MM/<date>--<id>.log.md` files (0.9.7 L3). Same
 * contract as the `log_entries` PostgREST repo; laws in test/file-log-entry-repo.test.ts.
 */
import {
  LogEntryValidationError,
  NotFoundError,
  type EditLogEntryInput,
  type ILogEntryManager,
  type ILogEntryRepository,
  type IWorkspaceFs,
  type LogEntry,
  type LogEntryFilter,
  type NewLogEntryInput,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { FileEntityStore, type ProjectRoot } from "./file-entity-store";

/** Newest entryDate first, then newest createdAt (the PostgREST order). */
function newestFirst(a: LogEntry, b: LogEntry): number {
  return b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt);
}

export class FileLogEntryRepository implements ILogEntryRepository, ILogEntryManager {
  private readonly store: FileEntityStore<LogEntry>;

  constructor(fs: IWorkspaceFs, root: ProjectRoot) {
    this.store = new FileEntityStore<LogEntry>(fs, root, "log_entry");
  }

  getById(id: string): Promise<LogEntry | null> {
    return this.store.get(id);
  }

  async list(filter: LogEntryFilter = {}): Promise<LogEntry[]> {
    const needle = filter.bodyContains?.toLowerCase();
    return (await this.store.all())
      .filter(
        (e) =>
          (!filter.kind || e.kind === filter.kind) &&
          (!filter.dateFrom || e.entryDate >= filter.dateFrom) &&
          (!filter.dateTo || e.entryDate <= filter.dateTo) &&
          (!needle || e.body.toLowerCase().includes(needle)),
      )
      .sort(newestFirst);
  }

  save(entry: LogEntry): Promise<void> {
    return this.store.save(entry);
  }

  delete(id: string): Promise<void> {
    return this.store.delete(id);
  }

  async add(input: NewLogEntryInput): Promise<LogEntry> {
    const core = readyCore();
    const problem = core.logEntryInputError(input);
    if (problem) throw new LogEntryValidationError(problem);
    const entry = core.createLogEntry(input, {
      clock: { nowIso: () => new Date().toISOString() },
      ids: { newId: () => crypto.randomUUID() },
    });
    await this.store.save(entry);
    return entry;
  }

  async update(id: string, input: EditLogEntryInput): Promise<LogEntry> {
    const current = await this.store.get(id);
    if (!current) throw new NotFoundError(`No log entry with id "${id}".`);
    const body = input.body.trim();
    if (!body) throw new LogEntryValidationError("Log entry body is required.");
    const next: LogEntry = { ...current, body, kind: input.kind };
    await this.store.save(next);
    return next;
  }

  remove(id: string): Promise<void> {
    return this.store.delete(id);
  }
}
