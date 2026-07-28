import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ICurrentUserProvider,
  ILabSnapshotRepository,
  LabSnapshot,
  LabSnapshotContent,
  PublishLabSnapshotInput,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";

interface LabSnapshotRow {
  id: string;
  project_id: string;
  title: string;
  note: string | null;
  content: LabSnapshotContent;
  published_at: string;
  created_at: string;
}

const TABLE = "lab_snapshots";

export class SupabaseLabSnapshotRepository implements ILabSnapshotRepository {
  constructor(
    private readonly db: SupabaseClient,
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
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        user_id: userId,
        project_id: this.projectId,
        title,
        note: input.note?.trim() || null,
        content: input.content,
      })
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as LabSnapshotRow);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }

  async listMine(): Promise<LabSnapshot[]> {
    const userId = await this.session.requireUserId();
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("published_at", { ascending: false });
    if (error) throw error;
    return (data as LabSnapshotRow[]).map(toDomain);
  }

  async listForMember(memberId: string): Promise<LabSnapshot[]> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("user_id", memberId)
      .order("published_at", { ascending: false });
    if (error) throw error;
    return (data as LabSnapshotRow[]).map(toDomain);
  }

  async getById(id: string): Promise<LabSnapshot | null> {
    const { data, error } = await this.db.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as LabSnapshotRow) : null;
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
