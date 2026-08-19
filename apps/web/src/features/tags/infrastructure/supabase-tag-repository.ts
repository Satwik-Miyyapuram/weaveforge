import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ITagRepository,
  IPaperTagRepository,
  Tag,
  PaperTag,
  TagSource,
  TagWithPaperCount,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  type TagRow,
  type PaperTagRow,
  toTagDomain,
  toPaperTagDomain,
} from "./tag-rows";

const TAGS = "tags";
const PAPER_TAGS = "paper_tags";

export class SupabaseTagRepository implements ITagRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<Tag | null> {
    const { data, error } = await this.db.from(TAGS).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toTagDomain(data as TagRow) : null;
  }

  async findByName(name: string): Promise<Tag | null> {
    let q = this.db.from(TAGS).select("*").eq("name", name);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ? toTagDomain(data as TagRow) : null;
  }

  async list(): Promise<Tag[]> {
    let q = this.db.from(TAGS).select("*").order("name");
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) throw error;
    return (data as TagRow[]).map(toTagDomain);
  }

  async listWithCounts(): Promise<TagWithPaperCount[]> {
    const tags = await this.list();
    if (tags.length === 0) return [];
    const { data, error } = await this.db.from(PAPER_TAGS).select("tag_id, paper_id");
    if (error) throw error;
    const counts = new Map<string, Set<string>>();
    for (const row of data as { tag_id: string; paper_id: string }[]) {
      (counts.get(row.tag_id) ?? counts.set(row.tag_id, new Set()).get(row.tag_id)!).add(row.paper_id);
    }
    return tags.map((t) => ({ ...t, paperCount: counts.get(t.id)?.size ?? 0 }));
  }

  async save(entity: Tag): Promise<void> {
    const row: Record<string, unknown> = {
      id: entity.id,
      name: entity.name,
      color: entity.color ?? null,
    };
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TAGS).upsert(row);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(TAGS).delete().eq("id", id);
    if (error) throw error;
  }
}

export class SupabasePaperTagRepository implements IPaperTagRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listForPaper(paperId: string): Promise<PaperTag[]> {
    const { data, error } = await this.db.from(PAPER_TAGS).select("*").eq("paper_id", paperId);
    if (error) throw error;
    return (data as PaperTagRow[]).map(toPaperTagDomain);
  }

  async listForTag(tagId: string): Promise<PaperTag[]> {
    const { data, error } = await this.db.from(PAPER_TAGS).select("*").eq("tag_id", tagId);
    if (error) throw error;
    return (data as PaperTagRow[]).map(toPaperTagDomain);
  }

  async listAll(): Promise<PaperTag[]> {
    const { data, error } = await this.db.from(PAPER_TAGS).select("*");
    if (error) throw error;
    return (data as PaperTagRow[]).map(toPaperTagDomain);
  }

  async link(link: PaperTag): Promise<void> {
    const { error } = await this.db.from(PAPER_TAGS).upsert(toPaperTagRow(link));
    if (error) throw error;
  }

  async unlink(paperId: string, tagId: string, source?: TagSource): Promise<void> {
    let q = this.db.from(PAPER_TAGS).delete().eq("paper_id", paperId).eq("tag_id", tagId);
    if (source) q = q.eq("source", source);
    const { error } = await q;
    if (error) throw error;
  }

  async unlinkBySource(paperId: string, source: TagSource): Promise<void> {
    const { error } = await this.db.from(PAPER_TAGS).delete().eq("paper_id", paperId).eq("source", source);
    if (error) throw error;
  }

  async reconcile(paperId: string, links: PaperTag[], sources: readonly TagSource[]): Promise<void> {
    if (sources.length > 0) {
      const { error } = await this.db.from(PAPER_TAGS).delete().eq("paper_id", paperId).in("source", sources as string[]);
      if (error) throw error;
    }
    if (links.length === 0) return;
    const { error } = await this.db.from(PAPER_TAGS).upsert(links.map(toPaperTagRow));
    if (error) throw error;
  }
}

function toPaperTagRow(l: PaperTag): Record<string, unknown> {
  const row: Record<string, unknown> = {
    paper_id: l.paperId,
    tag_id: l.tagId,
    source: l.source,
  };
  if (l.annotationRef) row.annotation_ref = l.annotationRef;
  return row;
}
