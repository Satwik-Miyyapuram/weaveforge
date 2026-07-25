import type { Identifiable } from "../../../shared/repository.js";
import { normalizeTags } from "../../papers/domain/paper.js";

/** Where a paper–tag link originated. */
export type TagSource = "zotero_annotation" | "zotero_item" | "summary" | "manual";

export const TAG_SOURCES: readonly TagSource[] = [
  "zotero_annotation",
  "zotero_item",
  "summary",
  "manual",
];

/** A normalized concept tag (first-class graph node). */
export interface Tag extends Identifiable {
  id: string;
  name: string;
  color?: string;
}

/** Join row linking a paper to a tag with provenance. */
export interface PaperTag {
  paperId: string;
  tagId: string;
  source: TagSource;
  /** Optional Zotero annotation key or synthetic ref for reconciliation. */
  annotationRef?: string;
}

export interface TagWithPaperCount extends Tag {
  paperCount: number;
}

export function normalizeTagName(raw: string): string {
  return normalizeTags([raw])[0] ?? "";
}
