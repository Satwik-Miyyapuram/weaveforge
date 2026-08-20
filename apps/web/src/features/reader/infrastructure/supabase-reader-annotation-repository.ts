import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CombinedPdfAnchor,
  ICurrentUserProvider,
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  NewReaderAnnotation,
  ReaderAnnotation,
  ReaderAnnotationPatch,
  ReaderAnnotationType,
  WorkspaceAnnotation,
} from "@weaveforge/core";
import { buildAnnotationSortIndex, isAnnotationSyncState, isReaderAnnotationType } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  type ReaderAnnotationRow,
  toDomain,
} from "./reader-annotation-rows";

const TABLE = "reader_annotations";

export class SupabaseReaderAnnotationRepository
  implements IReaderAnnotationSource, IReaderAnnotationSink
{
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing reader annotations.");
    return id;
  }

  async list(paperId: string): Promise<ReaderAnnotation[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .eq("paper_id", paperId)
      .order("sort_index", { ascending: true });
    if (error) throw error;
    return (data as ReaderAnnotationRow[]).map(toDomain);
  }

  /**
   * Every annotation in the project, for the search index.
   *
   * Separate from `list` because that one answers "what is on this paper" and
   * the caller already knows the paper; here the paper and page have to travel
   * with each row or a hit cannot open where it came from.
   */
  async listForProject(): Promise<WorkspaceAnnotation[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("sort_index", { ascending: true });
    if (error) throw error;
    return (data as ReaderAnnotationRow[]).map((row) => ({
      ...toDomain(row),
      paperId: row.paper_id,
      pageIndex: row.page_index,
    }));
  }

  async create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation> {
    if (!isReaderAnnotationType(draft.type)) {
      throw new Error(`Invalid annotation type: ${draft.type}`);
    }
    const userId = await this.session.requireUserId();
    const sortIndex =
      draft.sortIndex?.trim() || buildAnnotationSortIndex(draft.pageIndex, 0, 0);
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        user_id: userId,
        project_id: this.projectId,
        paper_id: paperId,
        origin: "local",
        type: draft.type,
        color: draft.color.trim() || "#ffd400",
        text: draft.text?.trim() ?? "",
        comment: draft.comment?.trim() ?? "",
        tags: draft.tags ?? [],
        anchor: draft.anchor,
        page_index: draft.pageIndex,
        sort_index: sortIndex,
        sync_state: "local",
      })
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as ReaderAnnotationRow);
  }

  async update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation> {
    const updates: Record<string, unknown> = {};
    if (patch.color !== undefined) updates.color = patch.color.trim() || "#ffd400";
    if (patch.text !== undefined) updates.text = patch.text.trim();
    if (patch.comment !== undefined) updates.comment = patch.comment.trim();
    if (patch.tags !== undefined) updates.tags = patch.tags;
    if (patch.anchor !== undefined) updates.anchor = patch.anchor;
    if (patch.sortIndex !== undefined) updates.sort_index = patch.sortIndex;

    const projectId = this.projectId;
    const { data, error } = await this.db
      .from(TABLE)
      .update(updates)
      .eq("id", id)
      .eq("project_id", projectId)
      .select("*")
      .single();
    if (error) throw error;

    // `pending` means "diverged from Zotero and owing a write-back". A row with
    // no Zotero counterpart can never owe one, so it stays `local` — marking it
    // pending would surface a sync state the user can never clear.
    const row = data as ReaderAnnotationRow;
    if (!row.zotero_key) return toDomain(row);

    const { data: flagged, error: flagError } = await this.db
      .from(TABLE)
      .update({ sync_state: "pending" })
      .eq("id", id)
      .eq("project_id", projectId)
      .select("*")
      .single();
    if (flagError) throw flagError;
    return toDomain(flagged as ReaderAnnotationRow);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq("id", id)
      .eq("project_id", this.projectId);
    if (error) throw error;
  }
}

