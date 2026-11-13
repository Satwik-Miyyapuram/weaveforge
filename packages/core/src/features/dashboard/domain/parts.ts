// --- dashboard-layout ---
/**
 * Dashboard grid layout types (pure domain, no I/O).
 */
/** Every dashboard card type id; the type below is derived from it (02-18). */
export const DASHBOARD_CARD_TYPES = [
  "reading-progress",
  "report-progress",
  "plan-progress",
  "experiments-summary",
  "needs-attention",
  "recent-log",
  "library-snapshot",
  "top-tags",
  "team-roster",
  "team-attention",
  "supervisee-snapshot",
] as const;

export type DashboardCardType = (typeof DASHBOARD_CARD_TYPES)[number];

export interface DashboardLayoutItem {
  id: string;
  type: DashboardCardType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

export interface DashboardLayout {
  lg: DashboardLayoutItem[];
  sm: DashboardLayoutItem[];
}

// --- parts ---
// --- dashboard-layout-repository ---
/** Per-project dashboard card grid layout (stored on the project row). */
export interface IDashboardLayoutRepository {
  get(projectId: string): Promise<DashboardLayout | null>;
  save(projectId: string, layout: DashboardLayout): Promise<void>;
}

// --- dashboard-stats ---
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
