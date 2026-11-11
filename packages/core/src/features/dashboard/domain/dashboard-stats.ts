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

