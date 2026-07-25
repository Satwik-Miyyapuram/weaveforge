import type { LogEntry, Member, Milestone } from "@thesis/core";
import { addDays } from "@thesis/core";

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
  today = new Date().toISOString().slice(0, 10),
): SuperviseeSummary {
  const milestonesDone = milestones.filter((m) => m.status === "done").length;
  const blocked = milestones.filter((m) => m.status === "blocked").length;
  const horizon = addDays(today, 14);
  const upcomingDue = milestones.filter(
    (m) =>
      m.status !== "done" &&
      m.targetDate &&
      m.targetDate >= today &&
      m.targetDate <= horizon,
  ).length;
  const lastLog = [...logs].sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0];
  let statusLabel = "on track";
  if (blocked > 0) statusLabel = "blocked";
  else if (upcomingDue > 0) statusLabel = `${upcomingDue} due soon`;

  return {
    member,
    milestonesTotal: milestones.length,
    milestonesDone,
    blocked,
    upcomingDue,
    lastLogDate: lastLog?.entryDate ?? null,
    statusLabel,
  };
}

export function teamAttentionItems(
  summaries: readonly SuperviseeSummary[],
  milestonesByMember: ReadonlyMap<string, readonly Milestone[]>,
  today = new Date().toISOString().slice(0, 10),
): TeamAttentionItem[] {
  const items: TeamAttentionItem[] = [];
  for (const s of summaries) {
    const name = s.member.fullName || s.member.email || "Unknown";
    const ms = milestonesByMember.get(s.member.id) ?? [];
    for (const m of ms) {
      if (m.status === "blocked") {
        items.push({
          memberId: s.member.id,
          memberName: name,
          label: `${name}: ${m.title} (blocked)`,
          href: `/supervision?member=${s.member.id}`,
        });
      } else if (m.status !== "done" && m.targetDate && m.targetDate < today) {
        items.push({
          memberId: s.member.id,
          memberName: name,
          label: `${name}: ${m.title} (overdue ${m.targetDate})`,
          href: `/supervision?member=${s.member.id}`,
        });
      }
    }
  }
  return items;
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
