import type { DashboardCardType, DashboardLayoutItem, Member } from "@weaveforge/core";
import type { DashboardStats } from "../../application/build-dashboard-stats";
import type { SupervisionStats } from "../../application/build-supervision-stats";
import {
  DashboardCardSkeleton,
  renderDashboardCard,
} from "./card-renderers";

export function DashboardCardBody({
  type,
  stats,
  supervision,
  item,
  supervisees,
  onSuperviseeConfig,
  shellVisible,
  showSkeleton,
  contentReady,
}: {
  type: DashboardCardType;
  stats: DashboardStats;
  supervision: SupervisionStats | null;
  item: DashboardLayoutItem;
  supervisees: Member[];
  onSuperviseeConfig?: (memberId: string) => void;
  shellVisible?: boolean;
  showSkeleton?: boolean;
  contentReady?: boolean;
}) {
  if (!shellVisible) return null;
  if (showSkeleton) {
    return <DashboardCardSkeleton />;
  }
  if (!contentReady) return null;
  return renderDashboardCard(type, {
    stats,
    supervision,
    item,
    supervisees,
    onSuperviseeConfig,
    contentReady: true,
  });
}
