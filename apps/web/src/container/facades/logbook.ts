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

  pushLog(entry: LogEntry) {
    return this.deps.logSync.pushLog(entry);
  }

  removeLog(entry: LogEntry) {
    return this.deps.logSync.removeLog(entry);
  }
}
