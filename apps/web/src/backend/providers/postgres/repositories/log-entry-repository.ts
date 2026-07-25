import {
  type ILogEntryRepository,
  type LogEntry,
  type LogEntryFilter,
  type LogKind,
  type LogLink,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";

interface LogEntryRow {
  id: string;
  entry_date: string;
  kind: LogKind;
  body: string;
  links: LogLink[] | null;
  created_at: string;
}

export class PostgresLogEntryRepository implements ILogEntryRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<LogEntry | null> {
    const row = await this.pg.queryOne<LogEntryRow>("select * from log_entries where id = $1", [id]);
    return row ? toDomain(row) : null;
  }

  async list(filter?: LogEntryFilter): Promise<LogEntry[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    if (filter?.kind) {
      params.push(filter.kind);
      clauses.push(`kind = $${params.length}`);
    }
    if (filter?.dateFrom) {
      params.push(filter.dateFrom);
      clauses.push(`entry_date >= $${params.length}`);
    }
    if (filter?.dateTo) {
      params.push(filter.dateTo);
      clauses.push(`entry_date <= $${params.length}`);
    }
    if (filter?.bodyContains) {
      params.push(`%${filter.bodyContains}%`);
      clauses.push(`body ilike $${params.length}`);
    }
    const rows = await this.pg.query<LogEntryRow>(
      `select * from log_entries where ${clauses.join(" and ")}
       order by entry_date desc, created_at desc`,
      params,
    );
    return rows.map(toDomain);
  }

  async save(entity: LogEntry): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into log_entries (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from log_entries where id = $1", [id]);
  }
}

function toDomain(row: LogEntryRow): LogEntry {
  return {
    id: row.id,
    entryDate: row.entry_date,
    kind: row.kind,
    body: row.body,
    links: row.links ?? [],
    createdAt: row.created_at,
  };
}

function toRow(e: LogEntry): Record<string, unknown> {
  return {
    id: e.id,
    entry_date: e.entryDate,
    kind: e.kind,
    body: e.body,
    links: e.links,
    created_at: e.createdAt,
  };
}
