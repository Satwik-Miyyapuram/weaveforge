/**
 * Reader annotations → indexable documents.
 *
 * A highlight's comment is frequently the only place a thought was written
 * down: you read a paragraph, you say why it matters, and that sentence never
 * becomes a note. Leaving annotations out of search means the app cannot find
 * the one piece of writing the reader is most likely to be looking for.
 *
 * Indexed separately from the paper rather than folded into it, so a hit can
 * open the reader at the right page instead of dropping you at the top of a
 * forty-page PDF.
 */

import type { WorkspaceAnnotation } from "../workspace/workspace-snapshot.js";
import { MAX_INDEXED_BODY_CHARS } from "./search-tuning.js";
import type { SearchDoc } from "./search-port.js";

/** Stable id for a highlight's document. */
export function annotationDocId(annotationId: string): string {
  return `annotation:${annotationId}`;
}

export function annotationHref(paperId: string, pageIndex: number): string {
  return `/reader?paper=${encodeURIComponent(paperId)}&page=${pageIndex}`;
}

/**
 * Nothing to search in an ink stroke or a cropped image.
 *
 * They are excluded rather than indexed with an empty body: a document with no
 * text still costs index space and can surface on a title-only match, which
 * from the reader's side looks like a bug.
 */
function hasText(annotation: WorkspaceAnnotation): boolean {
  return annotation.text.trim() !== "" || annotation.comment.trim() !== "";
}

/**
 * Project annotations into search documents.
 *
 * The title is the paper's, because that is how someone looks for a highlight —
 * "that thing I marked in the Vaswani paper". The quoted passage and the
 * comment both go in the body, so either one finds it.
 */
export function toAnnotationSearchDocs(
  annotations: readonly WorkspaceAnnotation[],
  paperTitles: ReadonlyMap<string, string>,
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  const docs: SearchDoc[] = [];

  for (const annotation of annotations) {
    if (!hasText(annotation)) continue;

    const body = [annotation.text.trim(), annotation.comment.trim()]
      .filter(Boolean)
      .join("\n\n");

    docs.push({
      id: annotationDocId(annotation.id),
      kind: "annotation",
      // The paper, so a kind filter and dedupe against the paper's own document
      // behave the way they do for PDF pages.
      entityId: annotation.paperId,
      title: paperTitles.get(annotation.paperId) ?? "Annotation",
      // The comment doubles as an alias so a short note ("key result") ranks
      // like a title rather than competing with the quoted paragraph.
      aliases: annotation.comment.trim() ? [annotation.comment.trim().slice(0, 120)] : [],
      headings: [],
      tags: [...annotation.tags],
      path: `page ${annotation.pageIndex + 1}`,
      body: body.length > MAX_INDEXED_BODY_CHARS ? body.slice(0, MAX_INDEXED_BODY_CHARS) : body,
      updatedAt: annotation.updatedAt || annotation.createdAt,
      href: annotationHref(annotation.paperId, annotation.pageIndex),
      page: annotation.pageIndex,
      degree: degrees.get(`paper:${annotation.paperId}`) ?? 0,
    });
  }

  return docs;
}
