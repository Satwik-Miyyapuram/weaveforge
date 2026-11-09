export interface DashboardMilestoneInput {
  title: string;
  status: string;
  targetDate?: string | null;
}

export interface DashboardAttentionItem {
  label: string;
  href: string;
}

export interface DashboardTopTag {
  name: string;
  count: number;
}

export interface DashboardSuperviseeCounts {
  milestonesTotal: number;
  milestonesDone: number;
  blocked: number;
  upcomingDue: number;
  lastLogDate: string | null;
  statusLabel: string;
}

export interface DashboardSuperviseeInput {
  member: { id: string; fullName?: string | null; email?: string | null };
  milestones: readonly DashboardMilestoneInput[];
}

export interface DashboardTeamAttentionItem {
  memberId: string;
  memberName: string;
  label: string;
  href: string;
}

/**
 * Signatures of the dashboard stats functions that moved to the Rust core (wf-core
 * `dashboard::stats`). Callers reach them through the core contract (typedCore()).
 */
export interface DashboardStatsFns {
  dashboardNeedsAttention(
    papers: readonly { status: string }[],
    milestones: readonly DashboardMilestoneInput[],
    experiments: readonly { status: string }[],
    today: string,
  ): readonly DashboardAttentionItem[];
  dashboardTopTags(
    tags: readonly { name: string; paperCount: number }[],
    limit: number,
  ): readonly DashboardTopTag[];
  dashboardSuperviseeCounts(
    milestones: readonly DashboardMilestoneInput[],
    logs: readonly { entryDate: string }[],
    today: string,
  ): DashboardSuperviseeCounts;
  dashboardTeamAttention(
    supervisees: readonly DashboardSuperviseeInput[],
    today: string,
  ): readonly DashboardTeamAttentionItem[];
}
