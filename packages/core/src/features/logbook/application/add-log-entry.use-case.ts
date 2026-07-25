/**
 * Use-case for adding log entries.
 *
 * Orchestration only: coordinates the domain factory and the repository. No
 * persistence details, no I/O — those are injected as interfaces (Dependency
 * Inversion). Its single responsibility is the business rule of recording a log
 * entry.
 */

import {
  createLogEntry,
  LogEntryValidationError,
  type LogEntry,
  type LogKind,
  type NewLogEntryInput,
} from "../domain/log-entry.js";
import type { ILogEntryRepository } from "../domain/log-entry-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

/** Editable fields of an existing log entry (id/date/createdAt are preserved). */
export interface EditLogEntryInput {
  body: string;
  kind: LogKind;
}

export interface AddLogEntryDeps {
  repository: ILogEntryRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class AddLogEntryUseCase {
  constructor(private readonly deps: AddLogEntryDeps) {}

  async add(input: NewLogEntryInput): Promise<LogEntry> {
    const entry = createLogEntry(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.deps.repository.save(entry);
    return entry;
  }

  async update(id: string, input: EditLogEntryInput): Promise<LogEntry> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) {
      throw new LogEntryValidationError(`No log entry with id "${id}".`);
    }
    const body = input.body?.trim();
    if (!body) {
      throw new LogEntryValidationError("Log entry body is required.");
    }
    const updated: LogEntry = {
      ...existing,
      body,
      kind: input.kind,
    };
    await this.deps.repository.save(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }
}
