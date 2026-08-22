import type { SqlRunner } from "./outbox";

/**
 * Which projects this device keeps offline.
 *
 * A choice per project rather than one switch for everything, because the
 * thing that makes offline expensive is PDFs, and a person with forty projects
 * wants the three they are writing from — not the archive.
 *
 * It lives on the device: the same account on a laptop and a desktop will not
 * want the same gigabytes, and syncing the choice would fight the person.
 */
export class OfflineScope {
  constructor(private readonly sql: SqlRunner) {}

  async enabled(projectId: string): Promise<boolean> {
    const row = await this.sql.queryOne<{ project_id: string }>(
      "select project_id from offline_projects where project_id = $1",
      [projectId],
    );
    return row !== null;
  }

  async list(): Promise<string[]> {
    const rows = await this.sql.query<{ project_id: string }>(
      "select project_id from offline_projects order by enabled_at",
    );
    return rows.map((row) => row.project_id);
  }

  async enable(projectId: string): Promise<void> {
    await this.sql.exec(
      "insert into offline_projects (project_id) values ($1) on conflict do nothing",
      [projectId],
    );
  }

  /**
   * Turning a project off releases its files but does not delete them here:
   * the cache decides what to remove and when, so a project turned off and
   * straight back on does not re-download what is still on disk.
   */
  async disable(projectId: string): Promise<void> {
    await this.sql.exec("delete from offline_projects where project_id = $1", [projectId]);
  }
}
