import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ILogEntryRepository,
  type LogEntry,
  type LogEntryFilter,
  type LogKind,
  type LogLink,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";

/**
 * Supabase implementation of ILogEntryRepository.
 *
 * The ONLY job of this class is persistence against the `log_entries` table,
 * including the snake_case <-> camelCase mapping. No business rules live here.
 * It must pass the same contract test suite as the in-memory repository
 * (run `runLogEntryRepositoryContract` against an instance pointed at a test DB).
 */

interface LogEntryRow {
  id: string;
  entry_date: string;
  kind: LogKind;
  body: string;
  links: LogLink[] | null;
  created_at: string;
  content_enc: string | null;
  enc_epoch: number | null;
}

const TABLE = "log_entries";

export class SupabaseLogEntryRepository implements ILogEntryRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<LogEntry | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as LogEntryRow) : null;
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
    const { data, error } = await query;
    if (error) throw error;
    return (data as LogEntryRow[]).map(toDomain);
  }

  async save(entity: LogEntry): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TABLE).upsert(row);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }
}

function toDomain(row: LogEntryRow): LogEntry {
  return attachEncryptedRow(
    {
      id: row.id,
      entryDate: row.entry_date,
      kind: row.kind,
      body: row.body,
      links: row.links ?? [],
      createdAt: row.created_at,
    },
    row,
  );
}

function toRow(e: LogEntry): Record<string, unknown> {
  return {
    id: e.id,
    entry_date: e.entryDate,
    kind: e.kind,
    body: e.body ?? "",
    links: e.links ?? [],
    created_at: e.createdAt,
    ...encryptedRowFields(e),
  };
}
