import {
  buildAnnotationSortIndex,
  isReaderAnnotationType,
  type IReaderAnnotationSink,
  type IReaderAnnotationSource,
  type NewReaderAnnotation,
  type ReaderAnnotation,
  type ReaderAnnotationPatch,
} from "../reader/index.js";

/** Combined source+sink for tests and local-only composition. */
export class InMemoryReaderAnnotationRepository
  implements IReaderAnnotationSource, IReaderAnnotationSink
{
  private readonly items = new Map<string, ReaderAnnotation & { paperId: string }>();
  private seq = 0;

  async list(paperId: string): Promise<ReaderAnnotation[]> {
    return [...this.items.values()]
      .filter((row) => row.paperId === paperId)
      .sort((a, b) => a.sortIndex.localeCompare(b.sortIndex))
      .map(({ paperId: _p, ...ann }) => structuredClone(ann));
  }

  async create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation> {
    if (!isReaderAnnotationType(draft.type)) {
      throw new Error(`Invalid annotation type: ${draft.type}`);
    }
    const now = new Date().toISOString();
    this.seq += 1;
    const pageIndex = draft.pageIndex;
    const sortIndex =
      draft.sortIndex?.trim() ||
      buildAnnotationSortIndex(pageIndex, 0, 0);
    const row: ReaderAnnotation & { paperId: string } = {
      id: `local-ann-${this.seq}`,
      origin: "local",
      zoteroKey: null,
      type: draft.type,
      color: draft.color.trim() || "#ffd400",
      text: draft.text?.trim() ?? "",
      comment: draft.comment?.trim() ?? "",
      tags: [...(draft.tags ?? [])],
      anchor: structuredClone(draft.anchor),
      sortIndex,
      createdAt: now,
      updatedAt: now,
      paperId,
    };
    this.items.set(row.id, row);
    const { paperId: _p, ...ann } = row;
    return structuredClone(ann);
  }

  async update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation> {
    const existing = this.items.get(id);
    if (!existing) throw new Error("Annotation not found");
    const now = new Date().toISOString();
    const next: ReaderAnnotation & { paperId: string } = {
      ...existing,
      color: patch.color?.trim() ?? existing.color,
      text: patch.text !== undefined ? patch.text.trim() : existing.text,
      comment: patch.comment !== undefined ? patch.comment.trim() : existing.comment,
      tags: patch.tags ? [...patch.tags] : existing.tags,
      anchor: patch.anchor ? structuredClone(patch.anchor) : existing.anchor,
      sortIndex: patch.sortIndex?.trim() || existing.sortIndex,
      updatedAt: now,
    };
    this.items.set(id, next);
    const { paperId: _p, ...ann } = next;
    return structuredClone(ann);
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}
