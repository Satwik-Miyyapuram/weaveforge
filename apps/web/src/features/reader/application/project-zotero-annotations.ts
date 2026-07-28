/**
 * Project cached Zotero annotations into the single ReaderAnnotation model.
 * Notes (kind === "note") are excluded — they are not page-anchored.
 */

import {
  buildAnnotationSortIndex,
  isReaderAnnotationType,
  type CombinedPdfAnchor,
  type ReaderAnnotation,
} from "@thesis/core";
import type { ZoteroAnnotation } from "@/features/papers/domain/zotero";

export function projectZoteroAnnotations(
  annotations: readonly ZoteroAnnotation[],
  options?: { contentHash?: string; now?: string },
): ReaderAnnotation[] {
  const now = options?.now ?? new Date(0).toISOString();
  const contentHash = options?.contentHash?.trim() || undefined;
  const out: ReaderAnnotation[] = [];

  for (const ann of annotations) {
    if (ann.kind === "note") continue;
    const type = ann.annotationType && isReaderAnnotationType(ann.annotationType)
      ? ann.annotationType
      : "highlight";
    const pageIndex = ann.annotationPosition?.pageIndex;
    const rects = ann.annotationPosition?.rects;
    const nextPageRects = ann.annotationPosition?.nextPageRects;
    const paths = ann.annotationPosition?.paths;

    const anchor: CombinedPdfAnchor = {
      contentHash,
      zoteroPosition:
        typeof pageIndex === "number" && pageIndex >= 0
          ? {
              pageIndex,
              ...(rects?.length ? { rects } : {}),
            }
          : undefined,
      locus: ann.text?.trim()
        ? {
            quote: {
              type: "TextQuoteSelector",
              exact: ann.text.trim(),
            },
          }
        : undefined,
    };

    // Preserve cross-page + ink geometry on the anchor via metadata-like fields
    // attached through a stable extension on zoteroPosition when present.
    if (anchor.zoteroPosition && (nextPageRects?.length || paths?.length)) {
      (anchor.zoteroPosition as { nextPageRects?: number[][]; paths?: number[][] }).nextPageRects =
        nextPageRects;
      (anchor.zoteroPosition as { nextPageRects?: number[][]; paths?: number[][] }).paths = paths;
    }

    const sortIndex =
      ann.annotationSortIndex?.trim() ||
      buildAnnotationSortIndex(
        typeof pageIndex === "number" ? pageIndex : 0,
        0,
        typeof pageIndex === "number" ? 0 : 0,
      );

    out.push({
      id: ann.key?.trim() || `zotero-${out.length + 1}`,
      origin: "zotero",
      zoteroKey: ann.key?.trim() || null,
      type,
      color: ann.color?.trim() || "#ffd400",
      text: ann.text?.trim() || "",
      comment: ann.comment?.trim() || "",
      tags: [...(ann.tags ?? [])],
      anchor,
      sortIndex,
      createdAt: now,
      updatedAt: now,
    });
  }

  return out.sort((a, b) => a.sortIndex.localeCompare(b.sortIndex));
}

export function partitionZoteroItems(annotations: readonly ZoteroAnnotation[]): {
  annotations: ZoteroAnnotation[];
  notes: ZoteroAnnotation[];
} {
  const anns: ZoteroAnnotation[] = [];
  const notes: ZoteroAnnotation[] = [];
  for (const item of annotations) {
    if (item.kind === "note") notes.push(item);
    else anns.push(item);
  }
  return { annotations: anns, notes };
}
