/**
 * In-memory implementation of ILogEntryRepository.
 *
 * Used by unit tests for the domain/application layers, and as the reference
 * against which the Supabase implementation is checked for Liskov
 * substitutability via the shared contract test suite.
 */

import type {
  LogEntry,
  LogEntryFilter,
} from "../features/logbook/domain/log-entry.js";
import type { ILogEntryRepository } from "../features/logbook/domain/log-entry-repository.js";

export class InMemoryLogEntryRepository implements ILogEntryRepository {
  private readonly store = new Map<string, LogEntry>();

  async getById(id: string): Promise<LogEntry | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: LogEntryFilter): Promise<LogEntry[]> {
    let items = [...this.store.values()];
    if (filter?.kind) {
      items = items.filter((e) => e.kind === filter.kind);
    }
    if (filter?.dateFrom) {
      items = items.filter((e) => e.entryDate >= filter.dateFrom!);
    }
    if (filter?.dateTo) {
      items = items.filter((e) => e.entryDate <= filter.dateTo!);
    }
    if (filter?.bodyContains) {
      const needle = filter.bodyContains.toLowerCase();
      items = items.filter((e) => e.body.toLowerCase().includes(needle));
    }
    // Most recent first: by entryDate, then createdAt as tiebreaker.
    return items.sort(
      (a, b) =>
        b.entryDate.localeCompare(a.entryDate) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }

  async save(entity: LogEntry): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
