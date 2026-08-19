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
import {
  milestoneToDomain,
  type MilestoneRow,
} from "@/features/plan/infrastructure/milestone-rows";
import {
  logEntryToDomain as logToDomain,
  type LogEntryRow,
} from "@/features/logbook/infrastructure/log-entry-rows";

/**
 * Reads a supervisee's milestones and log entries by owner user id, across all
 * of their projects. Not project-scoped (a supervisor doesn't select the
 * student's project) — row-level security restricts results to members in the
 * caller's subtree, and the explicit `user_id` filter narrows to one person.
 */

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

  async listMilestonesFor(memberIds: readonly string[]): Promise<Map<string, Milestone[]>> {
    if (memberIds.length === 0) return new Map();
    const { data, error } = await this.db
      .from("milestones")
      .select("*, user_id")
      .in("user_id", memberIds)
      .order("target_date", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return groupByOwner(data as (MilestoneRow & { user_id: string })[], memberIds, milestoneToDomain);
  }

  async listLogsFor(memberIds: readonly string[]): Promise<Map<string, LogEntry[]>> {
    if (memberIds.length === 0) return new Map();
    const { data, error } = await this.db
      .from("log_entries")
      .select("*, user_id")
      .in("user_id", memberIds)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return groupByOwner(data as (LogEntryRow & { user_id: string })[], memberIds, logToDomain);
  }
}

/**
 * Split rows back out by owner, preserving the order the database returned.
 *
 * Every requested id gets an entry, empty or not: a supervisee with no logs has
 * to read as "nothing yet", not as "not loaded".
 */
function groupByOwner<Row extends { user_id: string }, T>(
  rows: readonly Row[],
  memberIds: readonly string[],
  toDomain: (row: Row) => T,
): Map<string, T[]> {
  const byOwner = new Map<string, T[]>(memberIds.map((id) => [id, []]));
  for (const row of rows) byOwner.get(row.user_id)?.push(toDomain(row));
  return byOwner;
}

