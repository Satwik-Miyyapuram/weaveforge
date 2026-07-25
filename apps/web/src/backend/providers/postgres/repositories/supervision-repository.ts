import type {
  ComputeNeed,
  ISupervisionRepository,
  LogEntry,
  LogKind,
  LogLink,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
} from "@thesis/core";
import type { PgRunner } from "../pg-runner";

interface MilestoneRow {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  target_date: string | null;
  dependencies: MilestoneDependency[] | null;
  compute: ComputeNeed[] | null;
  created_at: string;
}

interface LogEntryRow {
  id: string;
  entry_date: string;
  kind: LogKind;
  body: string;
  links: LogLink[] | null;
  created_at: string;
}

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
}

function milestoneToDomain(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    status: r.status,
    targetDate: r.target_date ?? undefined,
    dependencies: r.dependencies ?? [],
    compute: r.compute ?? [],
    createdAt: r.created_at,
  };
}

function logToDomain(r: LogEntryRow): LogEntry {
  return {
    id: r.id,
    entryDate: r.entry_date,
    kind: r.kind,
    body: r.body,
    links: r.links ?? [],
    createdAt: r.created_at,
  };
}
