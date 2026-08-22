import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CitationAlertTrack,
  ICitationAlertTrackRepository,
  ICurrentUserProvider,
  NewCitationAlertTrackInput,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import { ProjectScopedSupabaseRepository } from "@/backend/providers/supabase/project-scoped-repository";
import {
  type TrackRow,
  toDomain,
} from "./citation-alert-track-rows";
import { one, rows, run } from "@/backend/providers/supabase/row-access";

const TABLE = "citation_alert_tracks";

export class SupabaseCitationAlertTrackRepository extends ProjectScopedSupabaseRepository implements ICitationAlertTrackRepository {
  protected readonly action = "managing citation alerts";

  async track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack> {
    const userId = await this.session.requireUserId();
    const { data, error } = await this.db
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          paper_id: input.paperId,
          seen_citing_ids: input.seenCitingIds ?? [],
          last_checked_at: input.lastCheckedAt ?? null,
        },
        { onConflict: "project_id,paper_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as TrackRow);
  }

  async untrack(paperId: string): Promise<void> {
    await run(this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId));
  }

  async listForProject(): Promise<CitationAlertTrack[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    return (await rows<TrackRow>(this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("tracked_at", { ascending: false }))).map(toDomain);
  }

  async getByPaperId(paperId: string): Promise<CitationAlertTrack | null> {
    const projectId = this.ctx.projectId;
    if (!projectId) return null;
    const row = await one<TrackRow>(this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .eq("paper_id", paperId)
      .maybeSingle());
    return row ? toDomain(row) : null;
  }

  async save(track: CitationAlertTrack): Promise<void> {
    await run(this.db
      .from(TABLE)
      .update({
        last_checked_at: track.lastCheckedAt ?? null,
        seen_citing_ids: track.seenCitingIds,
      })
      .eq("id", track.id)
      .eq("project_id", this.projectId));
  }
}

