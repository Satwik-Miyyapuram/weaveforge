import type {
  ITagRepository,
  IPaperTagRepository,
  Tag,
  PaperTag,
  TagSource,
  TagWithPaperCount,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";

interface TagRow {
  id: string;
  name: string;
  color: string | null;
}

interface PaperTagRow {
  paper_id: string;
  tag_id: string;
  source: string;
  annotation_ref: string | null;
}

export class PostgresTagRepository implements ITagRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<Tag | null> {
    const row = await this.pg.queryOne<TagRow>("select * from tags where id = $1", [id]);
    return row ? toTagDomain(row) : null;
  }

  async findByName(name: string): Promise<Tag | null> {
    const clauses = ["name = $1"];
    const params: unknown[] = [name];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const row = await this.pg.queryOne<TagRow>(
      `select * from tags where ${clauses.join(" and ")}`,
      params,
    );
    return row ? toTagDomain(row) : null;
  }

  async list(): Promise<Tag[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<TagRow>(
      `select * from tags where ${clauses.join(" and ")} order by name asc`,
      params,
    );
    return rows.map(toTagDomain);
  }

  async listWithCounts(): Promise<TagWithPaperCount[]> {
    const tags = await this.list();
    if (tags.length === 0) return [];
    const rows = await this.pg.query<{ tag_id: string; paper_id: string }>(
      "select tag_id, paper_id from paper_tags",
    );
    const counts = new Map<string, Set<string>>();
    for (const row of rows) {
      (counts.get(row.tag_id) ?? counts.set(row.tag_id, new Set()).get(row.tag_id)!).add(
        row.paper_id,
      );
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
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into tags (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from tags where id = $1", [id]);
  }
}

export class PostgresPaperTagRepository implements IPaperTagRepository {
  constructor(private readonly pg: PgRunner) {}

  async listForPaper(paperId: string): Promise<PaperTag[]> {
    const rows = await this.pg.query<PaperTagRow>(
      "select * from paper_tags where paper_id = $1",
      [paperId],
    );
    return rows.map(toPaperTagDomain);
  }

  async listForTag(tagId: string): Promise<PaperTag[]> {
    const rows = await this.pg.query<PaperTagRow>(
      "select * from paper_tags where tag_id = $1",
      [tagId],
    );
    return rows.map(toPaperTagDomain);
  }

  async listAll(): Promise<PaperTag[]> {
    const rows = await this.pg.query<PaperTagRow>("select * from paper_tags");
    return rows.map(toPaperTagDomain);
  }

  async link(link: PaperTag): Promise<void> {
    const row = toPaperTagRow(link);
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols
      .filter((c) => c !== "paper_id" && c !== "tag_id" && c !== "source")
      .map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into paper_tags (${cols.join(",")}) values (${vals.join(",")})
       on conflict (paper_id, tag_id, source) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async unlink(paperId: string, tagId: string, source?: TagSource): Promise<void> {
    if (source) {
      await this.pg.exec(
        "delete from paper_tags where paper_id = $1 and tag_id = $2 and source = $3",
        [paperId, tagId, source],
      );
    } else {
      await this.pg.exec("delete from paper_tags where paper_id = $1 and tag_id = $2", [
        paperId,
        tagId,
      ]);
    }
  }

  async unlinkBySource(paperId: string, source: TagSource): Promise<void> {
    await this.pg.exec("delete from paper_tags where paper_id = $1 and source = $2", [
      paperId,
      source,
    ]);
  }

  async reconcile(
    paperId: string,
    links: PaperTag[],
    sources: readonly TagSource[],
  ): Promise<void> {
    if (sources.length > 0) {
      await this.pg.exec(
        "delete from paper_tags where paper_id = $1 and source = any($2::text[])",
        [paperId, sources],
      );
    }
    for (const link of links) {
      await this.link(link);
    }
  }
}

function toTagDomain(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color ?? undefined };
}

function toPaperTagDomain(row: PaperTagRow): PaperTag {
  return {
    paperId: row.paper_id,
    tagId: row.tag_id,
    source: row.source as TagSource,
    annotationRef: row.annotation_ref ?? undefined,
  };
}

function toPaperTagRow(l: PaperTag): Record<string, unknown> {
  return {
    paper_id: l.paperId,
    tag_id: l.tagId,
    source: l.source,
    annotation_ref: l.annotationRef ?? null,
  };
}
