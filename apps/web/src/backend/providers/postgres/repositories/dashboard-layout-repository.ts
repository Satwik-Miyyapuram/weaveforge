import { parseDashboardLayout, type DashboardLayout, type IDashboardLayoutRepository } from "@weaveforge/core";
import type { PgRunner } from "../pg-runner";

interface LayoutRow {
  dashboard_layout: unknown;
}

export class PostgresDashboardLayoutRepository implements IDashboardLayoutRepository {
  constructor(private readonly pg: PgRunner) {}

  async get(projectId: string): Promise<DashboardLayout | null> {
    const row = await this.pg.queryOne<LayoutRow>(
      "select dashboard_layout from projects where id = $1",
      [projectId],
    );
    if (!row?.dashboard_layout) return null;
    return parseDashboardLayout(row.dashboard_layout);
  }

  async save(projectId: string, layout: DashboardLayout): Promise<void> {
    await this.pg.exec("update projects set dashboard_layout = $1 where id = $2", [
      layout,
      projectId,
    ]);
  }
}
