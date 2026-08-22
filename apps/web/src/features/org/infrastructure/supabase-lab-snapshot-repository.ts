import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ICurrentUserProvider,
  ILabSnapshotRepository,
  LabSnapshot,
  LabSnapshotContent,
  PublishLabSnapshotInput,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import { ProjectScopedSupabaseRepository } from "@/backend/providers/supabase/project-scoped-repository";
import {
  type LabSnapshotRow,
  toDomain,
} from "./lab-snapshot-rows";
import { rows, run } from "@/backend/providers/supabase/row-access";

const TABLE = "lab_snapshots";

export class SupabaseLabSnapshotRepository extends ProjectScopedSupabaseRepository implements ILabSnapshotRepository {
  protected readonly action = "publishing a lab snapshot";

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
    await run(this.db.from(TABLE).delete().eq("id", id));
  }

  async listMine(): Promise<LabSnapshot[]> {
    const userId = await this.session.requireUserId();
    return (await rows<LabSnapshotRow>(this.db
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("published_at", { ascending: false }))).map(toDomain);
  }

  async listForMember(memberId: string): Promise<LabSnapshot[]> {
    return (await rows<LabSnapshotRow>(this.db
      .from(TABLE)
      .select("*")
      .eq("user_id", memberId)
      .order("published_at", { ascending: false }))).map(toDomain);
  }

  async getById(id: string): Promise<LabSnapshot | null> {
    const { data, error } = await this.db.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as LabSnapshotRow) : null;
  }
}

