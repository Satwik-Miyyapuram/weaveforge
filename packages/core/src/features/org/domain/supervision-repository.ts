/**
 * Read contract for the supervisor view (DIP).
 *
 * A supervisor can follow the *plan* and *logbook* of the people beneath them —
 * and nothing else. This interface intentionally exposes only milestones and
 * log entries, by member, across all of that member's projects. Row-level
 * security is the ultimate gate on which members are visible.
 */

import type { Milestone } from "../../plan/domain/milestone.js";
import type { LogEntry } from "../../logbook/domain/log-entry.js";

export interface ISupervisionRepository {
  /** All milestones owned by `memberId` (soonest target first). */
  listMilestones(memberId: string): Promise<Milestone[]>;
  /** All log entries owned by `memberId` (most recent first). */
  listLogs(memberId: string): Promise<LogEntry[]>;
}
