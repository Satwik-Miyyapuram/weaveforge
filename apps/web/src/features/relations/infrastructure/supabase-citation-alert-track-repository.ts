import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CitationAlertTrack,
  ICitationAlertTrackRepository,
  ICurrentUserProvider,
  NewCitationAlertTrackInput,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";

interface TrackRow {
  id: string;
  paper_id: string;
  tracked_at: string;
  last_checked_at: string | null;
  seen_citing_ids: string[] | null;
}

const TABLE = "citation_alert_tracks";

export class SupabaseCitationAlertTrackRepository implements ICitationAlertTrackRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing citation alerts.");
    return id;
  }

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
    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId);
    if (error) throw error;
  }

  async listForProject(): Promise<CitationAlertTrack[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("tracked_at", { ascending: false });
    if (error) throw error;
    return (data as TrackRow[]).map(toDomain);
  }

  async getByPaperId(paperId: string): Promise<CitationAlertTrack | null> {
    const projectId = this.ctx.projectId;
    if (!projectId) return null;
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .eq("paper_id", paperId)
      .maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as TrackRow) : null;
  }

  async save(track: CitationAlertTrack): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .update({
        last_checked_at: track.lastCheckedAt ?? null,
        seen_citing_ids: track.seenCitingIds,
      })
      .eq("id", track.id)
      .eq("project_id", this.projectId);
    if (error) throw error;
  }
}

function toDomain(row: TrackRow): CitationAlertTrack {
  return {
    id: row.id,
    paperId: row.paper_id,
    trackedAt: row.tracked_at,
    lastCheckedAt: row.last_checked_at ?? undefined,
    seenCitingIds: row.seen_citing_ids ?? [],
  };
}
