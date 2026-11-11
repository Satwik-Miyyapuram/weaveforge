import type { Identifiable } from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";

// --- tag ---
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
  return rust().normalizeTags([raw])[0] ?? "";
}

// --- tag-repository ---
export interface ITagRepository {
  getById(id: string): Promise<Tag | null>;
  findByName(name: string): Promise<Tag | null>;
  list(): Promise<Tag[]>;
  listWithCounts(): Promise<TagWithPaperCount[]>;
  save(tag: Tag): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IPaperTagRepository {
  listForPaper(paperId: string): Promise<PaperTag[]>;
  listForTag(tagId: string): Promise<PaperTag[]>;
  listAll(): Promise<PaperTag[]>;
  link(link: PaperTag): Promise<void>;
  unlink(paperId: string, tagId: string, source?: TagSource): Promise<void>;
  unlinkBySource(paperId: string, source: TagSource): Promise<void>;
  /** Replace all links for a paper from the given sources. */
  reconcile(paperId: string, links: PaperTag[], sources: readonly TagSource[]): Promise<void>;
}
