import type {
  ComputeNeed,
  ISupervisionRepository,
  LogEntry,
  LogKind,
  LogLink,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
} from "@weaveforge/core";
import type { PgRunner } from "../pg-runner";
import {
  milestoneToDomain,
  type MilestoneRow,
} from "@/features/plan/infrastructure/milestone-rows";
import {
  logEntryToDomain as logToDomain,
  type LogEntryRow,
} from "@/features/logbook/infrastructure/log-entry-rows";

export class PostgresSupervisionRepository implements ISupervisionRepository {
  constructor(private readonly pg: PgRunner) {}

  async listMilestones(memberId: string): Promise<Milestone[]> {
    const rows = await this.pg.query<MilestoneRow>(
      `select * from milestones where user_id = $1 order by target_date asc nulls last`,
      [memberId],
    );
    return rows.map(milestoneToDomain);
  }

  async listLogs(memberId: string): Promise<LogEntry[]> {
    const rows = await this.pg.query<LogEntryRow>(
      `select * from log_entries where user_id = $1
       order by entry_date desc, created_at desc`,
      [memberId],
    );
    return rows.map(logToDomain);
  }

  async listMilestonesFor(memberIds: readonly string[]): Promise<Map<string, Milestone[]>> {
    if (memberIds.length === 0) return new Map();
    const rows = await this.pg.query<MilestoneRow & { user_id: string }>(
      `select * from milestones where user_id = any($1) order by target_date asc nulls last`,
      [memberIds],
    );
    return groupByOwner(rows, memberIds, milestoneToDomain);
  }

  async listLogsFor(memberIds: readonly string[]): Promise<Map<string, LogEntry[]>> {
    if (memberIds.length === 0) return new Map();
    const rows = await this.pg.query<LogEntryRow & { user_id: string }>(
      `select * from log_entries where user_id = any($1)
       order by entry_date desc, created_at desc`,
      [memberIds],
    );
    return groupByOwner(rows, memberIds, logToDomain);
  }
}

/** Split rows by owner, keeping database order; requested ids always present. */
function groupByOwner<Row extends { user_id: string }, T>(
  rows: readonly Row[],
  memberIds: readonly string[],
  toDomain: (row: Row) => T,
): Map<string, T[]> {
  const byOwner = new Map<string, T[]>(memberIds.map((id) => [id, []]));
  for (const row of rows) byOwner.get(row.user_id)?.push(toDomain(row));
  return byOwner;
}

