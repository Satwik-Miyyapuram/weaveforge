import type {
  ICurrentUserProvider,
  ILabSnapshotRepository,
  LabSnapshot,
  LabSnapshotContent,
  PublishLabSnapshotInput,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";

interface LabSnapshotRow {
  id: string;
  project_id: string;
  title: string;
  note: string | null;
  content: LabSnapshotContent;
  published_at: string;
  created_at: string;
}

export class PostgresLabSnapshotRepository implements ILabSnapshotRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before publishing a lab snapshot.");
    return id;
  }

  async publish(input: PublishLabSnapshotInput): Promise<LabSnapshot> {
    const title = input.title.trim();
    if (!title) throw new Error("Snapshot title is required.");
    const userId = await this.session.requireUserId();
    const rows = await this.pg.query<LabSnapshotRow>(
      `insert into lab_snapshots
         (user_id, project_id, title, note, content)
       values ($1, $2, $3, $4, $5::jsonb)
       returning *`,
      [
        userId,
        this.projectId,
        title,
        input.note?.trim() || null,
        JSON.stringify(input.content),
      ],
    );
    return toDomain(rows[0]!);
  }

  async remove(id: string): Promise<void> {
    await this.pg.query(
      `delete from lab_snapshots where user_id = auth.uid() and id = $1`,
      [id],
    );
  }

  async listMine(): Promise<LabSnapshot[]> {
    const userId = await this.session.requireUserId();
    const rows = await this.pg.query<LabSnapshotRow>(
      `select * from lab_snapshots
       where user_id = $1
       order by published_at desc`,
      [userId],
    );
    return rows.map(toDomain);
  }

  async listForMember(memberId: string): Promise<LabSnapshot[]> {
    const rows = await this.pg.query<LabSnapshotRow>(
      `select * from lab_snapshots
       where user_id = $1
       order by published_at desc`,
      [memberId],
    );
    return rows.map(toDomain);
  }

  async getById(id: string): Promise<LabSnapshot | null> {
    const rows = await this.pg.query<LabSnapshotRow>(
      `select * from lab_snapshots where id = $1`,
      [id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }
}

function toDomain(row: LabSnapshotRow): LabSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    note: row.note ?? undefined,
    content: row.content ?? { milestones: [], logs: [] },
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}
