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
import type { PgRunner } from "../pg-runner";

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

export class PostgresReaderAnnotationRepository
  implements IReaderAnnotationSource, IReaderAnnotationSink
{
  constructor(
    private readonly pg: PgRunner,
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
    const rows = await this.pg.query<ReaderAnnotationRow>(
      `select * from reader_annotations
       where user_id = auth.uid() and project_id = $1 and paper_id = $2
       order by sort_index asc`,
      [projectId, paperId],
    );
    return rows.map(toDomain);
  }

  async create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation> {
    if (!isReaderAnnotationType(draft.type)) {
      throw new Error(`Invalid annotation type: ${draft.type}`);
    }
    const userId = await this.session.requireUserId();
    const sortIndex =
      draft.sortIndex?.trim() || buildAnnotationSortIndex(draft.pageIndex, 0, 0);
    const rows = await this.pg.query<ReaderAnnotationRow>(
      `insert into reader_annotations
         (user_id, project_id, paper_id, origin, type, color, text, comment, tags,
          anchor, page_index, sort_index, sync_state)
       values ($1,$2,$3,'local',$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'local')
       returning *`,
      [
        userId,
        this.projectId,
        paperId,
        draft.type,
        draft.color.trim() || "#ffd400",
        draft.text?.trim() ?? "",
        draft.comment?.trim() ?? "",
        draft.tags ?? [],
        JSON.stringify(draft.anchor),
        draft.pageIndex,
        sortIndex,
      ],
    );
    return toDomain(rows[0]!);
  }

  async update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation> {
    const rows = await this.pg.query<ReaderAnnotationRow>(
      `update reader_annotations set
         color = coalesce($3, color),
         text = coalesce($4, text),
         comment = coalesce($5, comment),
         tags = coalesce($6, tags),
         anchor = coalesce($7::jsonb, anchor),
         sort_index = coalesce($8, sort_index),
         updated_at = now()
       where user_id = auth.uid() and project_id = $1 and id = $2
       returning *`,
      [
        this.projectId,
        id,
        patch.color?.trim() ?? null,
        patch.text !== undefined ? patch.text.trim() : null,
        patch.comment !== undefined ? patch.comment.trim() : null,
        patch.tags ?? null,
        patch.anchor ? JSON.stringify(patch.anchor) : null,
        patch.sortIndex ?? null,
      ],
    );
    if (!rows[0]) throw new Error("Annotation not found");
    return toDomain(rows[0]);
  }

  async remove(id: string): Promise<void> {
    await this.pg.query(
      `delete from reader_annotations
       where user_id = auth.uid() and project_id = $1 and id = $2`,
      [this.projectId, id],
    );
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
