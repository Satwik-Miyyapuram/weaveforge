import type { LogEntry, Member, Milestone } from "@weaveforge/core";
import { localIsoDate } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

export interface SuperviseeSummary {
  member: Member;
  milestonesTotal: number;
  milestonesDone: number;
  blocked: number;
  upcomingDue: number;
  lastLogDate: string | null;
  statusLabel: string;
}

export interface TeamAttentionItem {
  memberId: string;
  memberName: string;
  label: string;
  href: string;
}

export interface SupervisionStats {
  roster: SuperviseeSummary[];
  teamAttention: TeamAttentionItem[];
}

export function summarizeSupervisee(
  member: Member,
  milestones: readonly Milestone[],
  logs: readonly LogEntry[],
  today = localIsoDate(),
): SuperviseeSummary {
  return { member, ...typedCore().dashboardSuperviseeCounts(milestones, logs, today) };
}

export function teamAttentionItems(
  summaries: readonly SuperviseeSummary[],
  milestonesByMember: ReadonlyMap<string, readonly Milestone[]>,
  today = localIsoDate(),
): TeamAttentionItem[] {
  const supervisees = summaries.map((s) => ({
    member: s.member,
    milestones: milestonesByMember.get(s.member.id) ?? [],
  }));
  return [...typedCore().dashboardTeamAttention(supervisees, today)];
}

export function buildSupervisionStats(
  supervisees: readonly Member[],
  milestonesByMember: ReadonlyMap<string, readonly Milestone[]>,
  logsByMember: ReadonlyMap<string, readonly LogEntry[]>,
): SupervisionStats {
  const roster = supervisees.map((m) =>
    summarizeSupervisee(
      m,
      milestonesByMember.get(m.id) ?? [],
      logsByMember.get(m.id) ?? [],
    ),
  );
  return {
    roster,
    teamAttention: teamAttentionItems(roster, milestonesByMember),
  };
}
