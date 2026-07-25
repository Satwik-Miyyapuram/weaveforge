import type { DashboardLayout } from "./dashboard-layout.js";

/** Per-project dashboard card grid layout (stored on the project row). */
export interface IDashboardLayoutRepository {
  get(projectId: string): Promise<DashboardLayout | null>;
  save(projectId: string, layout: DashboardLayout): Promise<void>;
}
