import {
  type ILogEntryRepository,
  type LogEntry,
  type LogEntryFilter,
  type LogKind,
  type LogLink,
} from "@weaveforge/core";
import { logEntryToDomain, logEntryToRow, type LogEntryRow } from "./log-entry-rows";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/supabase/row-access";
import { ProjectRepository } from "@/backend/providers/supabase/project-scoped-repository";

/**
 * Supabase implementation of ILogEntryRepository.
 *
 * The ONLY job of this class is persistence against the `log_entries` table,
 * including the snake_case <-> camelCase mapping. No business rules live here.
 * It must pass the same contract test suite as the in-memory repository
 * (run `runLogEntryRepositoryContract` against an instance pointed at a test DB).
 */


const TABLE = "log_entries";

export class SupabaseLogEntryRepository extends ProjectRepository implements ILogEntryRepository {

  async getById(id: string): Promise<LogEntry | null> {
    const row = await rowById<LogEntryRow>(this.db, TABLE, id);
    return row ? logEntryToDomain(row) : null;
  }

  async list(filter?: LogEntryFilter): Promise<LogEntry[]> {
    let query = this.db.from(TABLE).select("*");
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.kind) query = query.eq("kind", filter.kind);
    if (filter?.dateFrom) query = query.gte("entry_date", filter.dateFrom);
    if (filter?.dateTo) query = query.lte("entry_date", filter.dateTo);
    if (filter?.bodyContains) {
      // Server ilike removed under E2EE — encryptRepo filters client-side post-decrypt.
    }
    query = query
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    return (await rows<LogEntryRow>(query)).map(logEntryToDomain);
  }

  async save(entity: LogEntry): Promise<void> {
    const row = logEntryToRow(entity);
    if (this.pid) row.project_id = this.pid;
    await run(this.db.from(TABLE).upsert(row));
  }

  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

