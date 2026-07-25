import type { Tag, PaperTag, TagSource, TagWithPaperCount } from "./tag.js";

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
