import type { AddLogEntryUseCase, ILogSyncIntegration, ILogEntryRepository, LogEntry } from "@weaveforge/core";

export class LogbookFacade {
  constructor(
    private readonly deps: {
      logEntries: ILogEntryRepository;
      addLogEntry: AddLogEntryUseCase;
      logSync: ILogSyncIntegration;
    },
  ) {}

  loadEntries() {
    return this.deps.logEntries.list();
  }

  get addLogEntry() {
    return this.deps.addLogEntry;
  }

  /**
   * Replace one entry's body, keeping what it already is.
   *
   * AddLogEntryUseCase.update takes the kind as well as the body, because the
   * logbook screen has both: it renders a Kind select beside the text. A pane
   * that edits the *markdown* has no opinion about the kind — it is metadata, in
   * the same category as a milestone's status — and a caller with no opinion
   * must not be able to clear one by omission. So the current row is read and
   * its kind passed back unchanged, here, where the logbook's own rule about
   * editability lives.
   *
   * The fallback kind is not reachable for a row that exists, and that is the
   * point: `getById` answering null means there is nothing to edit, and the
   * update throws NotFound either way. Naming a value here keeps the failure the
   * one the use case already reports rather than inventing a second one.
   */
  async saveEntryBody(id: string, body: string): Promise<LogEntry> {
    const existing = await this.deps.logEntries.getById(id);
    return this.deps.addLogEntry.update(id, { body, kind: existing?.kind ?? "daily" });
  }

  pushLog(entry: LogEntry) {
    return this.deps.logSync.pushLog(entry);
  }

  removeLog(entry: LogEntry) {
    return this.deps.logSync.removeLog(entry);
  }
}
