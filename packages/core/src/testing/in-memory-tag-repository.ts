import type { Tag, PaperTag, TagSource, TagWithPaperCount } from "../features/tags/domain/tag.js";
import type { ITagRepository, IPaperTagRepository } from "../features/tags/domain/tag-repository.js";

export class InMemoryTagRepository implements ITagRepository {
  constructor(private readonly paperTags?: IPaperTagRepository) {}

  async getById(id: string): Promise<Tag | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string): Promise<Tag | null> {
    for (const t of this.store.values()) {
      if (t.name === name) return t;
    }
    return null;
  }

  async list(): Promise<Tag[]> {
    return [...this.store.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listWithCounts(): Promise<TagWithPaperCount[]> {
    const tags = await this.list();
    if (!this.paperTags) {
      return tags.map((t) => ({ ...t, paperCount: 0 }));
    }
    const links = await this.paperTags.listAll();
    const counts = new Map<string, Set<string>>();
    for (const l of links) {
      const set = counts.get(l.tagId) ?? new Set<string>();
      set.add(l.paperId);
      counts.set(l.tagId, set);
    }
    return tags.map((t) => ({
      ...t,
      paperCount: counts.get(t.id)?.size ?? 0,
    }));
  }

  async save(entity: Tag): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  private readonly store = new Map<string, Tag>();
}

export class InMemoryPaperTagRepository implements IPaperTagRepository {
  private readonly store = new Map<string, PaperTag>();

  private key(l: PaperTag) {
    return `${l.paperId}:${l.tagId}:${l.source}`;
  }

  async listForPaper(paperId: string): Promise<PaperTag[]> {
    return [...this.store.values()].filter((l) => l.paperId === paperId);
  }

  async listForTag(tagId: string): Promise<PaperTag[]> {
    return [...this.store.values()].filter((l) => l.tagId === tagId);
  }

  async listAll(): Promise<PaperTag[]> {
    return [...this.store.values()];
  }

  async link(link: PaperTag): Promise<void> {
    this.store.set(this.key(link), { ...link });
  }

  async unlink(paperId: string, tagId: string, source?: TagSource): Promise<void> {
    for (const [k, l] of this.store) {
      if (l.paperId === paperId && l.tagId === tagId && (source == null || l.source === source)) {
        this.store.delete(k);
      }
    }
  }

  async unlinkBySource(paperId: string, source: TagSource): Promise<void> {
    for (const [k, l] of this.store) {
      if (l.paperId === paperId && l.source === source) this.store.delete(k);
    }
  }

  async reconcile(paperId: string, links: PaperTag[], sources: readonly TagSource[]): Promise<void> {
    const src = new Set(sources);
    for (const [k, l] of [...this.store]) {
      if (l.paperId === paperId && src.has(l.source)) this.store.delete(k);
    }
    for (const l of links) this.store.set(this.key(l), { ...l });
  }
}
