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
} from "@thesis/core";
import { buildAnnotationSortIndex, isAnnotationSyncState, isReaderAnnotationType } from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";

interface ReaderAnnotationRow {
  id: string;
  paper_id: string;
  origin: "local" | "zotero";
  zotero_key: string | null;
  type: string;
  color: string;
  text: string;
  comment: string;
  tags: string[] | null;
  anchor: CombinedPdfAnchor;
  page_index: number;
  sort_index: string;
  sync_state?: string | null;
  zotero_version?: number | null;
  created_at: string;
  updated_at: string;
}

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
    const { data, error } = await this.db
      .from(TABLE)
      .update(updates)
      .eq("id", id)
      .eq("project_id", this.projectId)
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as ReaderAnnotationRow);
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

function toDomain(row: ReaderAnnotationRow): ReaderAnnotation {
  if (!isReaderAnnotationType(row.type)) {
    throw new Error(`Invalid annotation type in store: ${row.type}`);
  }
  return {
    id: row.id,
    origin: row.origin,
    zoteroKey: row.zotero_key,
    type: row.type as ReaderAnnotationType,
    color: row.color,
    text: row.text,
    comment: row.comment,
    tags: row.tags ?? [],
    anchor: row.anchor ?? {},
    sortIndex: row.sort_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state && isAnnotationSyncState(row.sync_state) ? row.sync_state : "local",
    zoteroVersion: row.zotero_version ?? null,
  };
}
