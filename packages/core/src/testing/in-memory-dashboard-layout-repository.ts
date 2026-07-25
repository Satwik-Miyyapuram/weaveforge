import type { DashboardLayout } from "../features/dashboard/domain/dashboard-layout.js";
import type { IDashboardLayoutRepository } from "../features/dashboard/domain/dashboard-layout-repository.js";

export class InMemoryDashboardLayoutRepository implements IDashboardLayoutRepository {
  private readonly layouts = new Map<string, DashboardLayout>();

  async get(projectId: string): Promise<DashboardLayout | null> {
    const layout = this.layouts.get(projectId);
    return layout ? structuredClone(layout) : null;
  }

  async save(projectId: string, layout: DashboardLayout): Promise<void> {
    this.layouts.set(projectId, structuredClone(layout));
  }
}
