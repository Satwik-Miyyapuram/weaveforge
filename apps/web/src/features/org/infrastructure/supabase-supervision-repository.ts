import type { SupabaseClient } from "@supabase/supabase-js";
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

/**
 * Reads a supervisee's milestones and log entries by owner user id, across all
 * of their projects. Not project-scoped (a supervisor doesn't select the
 * student's project) — row-level security restricts results to members in the
 * caller's subtree, and the explicit `user_id` filter narrows to one person.
 */
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

export class SupabaseSupervisionRepository implements ISupervisionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listMilestones(memberId: string): Promise<Milestone[]> {
    const { data, error } = await this.db
      .from("milestones")
      .select("*")
      .eq("user_id", memberId)
      .order("target_date", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data as MilestoneRow[]).map(milestoneToDomain);
  }

  async listLogs(memberId: string): Promise<LogEntry[]> {
    const { data, error } = await this.db
      .from("log_entries")
      .select("*")
      .eq("user_id", memberId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as LogEntryRow[]).map(logToDomain);
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
