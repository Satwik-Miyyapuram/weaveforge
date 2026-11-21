/**
 * Paper relations from paper files (0.9.7 L3). Same contract as the
 * `paper_relations` repo; laws in test/file-relation-repo.test.ts.
 *
 * An edge lives in its source paper's `relations` frontmatter and names its target
 * by `[[link]]`, never by id:
 *
 * ```yaml
 * relations: [{"to":"[[vae.paper]]","type":"cites","id":"r1","source":"manual","created-at":"…","note":"…"}]
 * ```
 *
 * A hand-typed `{"to":"[[vae.paper]]","type":"cites"}` reads with id
 * `<from>:<type>:<to>`, source `manual` and no date. A bare id in `to` (older
 * files) still reads. An edge whose target resolves to nothing, or whose type the
 * app does not know, is not listed but stays in the file.
 */
import {
  NotFoundError,
  type IPaperRelationRepository,
  type IWorkspaceFs,
  type PaperRelation,
  type RelationType,
} from "@weaveforge/core";
import type { FilePaperRepository, PaperExtras } from "@/features/papers/infrastructure/file-paper-repository";
import type { ProjectRoot } from "./file-entity-store";
import { LinkIndex } from "./link-index";

type RelationEntry = PaperExtras["relations"][number];

const TYPES: readonly RelationType[] = ["cites", "extends", "contradicts", "similar", "builds_on", "uses_method"];

/** The slice of `FilePaperRepository` this needs. */
export type RelatedPapers = Pick<FilePaperRepository, "getById" | "listExtras" | "updateExtras">;

export class FilePaperRelationRepository implements IPaperRelationRepository {
  private readonly links: LinkIndex;

  constructor(
    private readonly papers: RelatedPapers,
    fs: IWorkspaceFs,
    root: ProjectRoot,
  ) {
    this.links = new LinkIndex(fs, root);
  }

  async getById(id: string): Promise<PaperRelation | null> {
    return (await this.list()).find((r) => r.id === id) ?? null;
  }

  async list(filter: { relation?: RelationType; fromPaper?: string; toPaper?: string } = {}): Promise<PaperRelation[]> {
    return (await this.all()).filter(
      (r) =>
        (!filter.relation || r.relation === filter.relation) &&
        (!filter.fromPaper || r.fromPaper === filter.fromPaper) &&
        (!filter.toPaper || r.toPaper === filter.toPaper),
    );
  }

  getGraph(): Promise<PaperRelation[]> {
    return this.all();
  }

  async relationsFor(paperId: string): Promise<PaperRelation[]> {
    return (await this.all()).filter((r) => r.fromPaper === paperId || r.toPaper === paperId);
  }

  async findEdge(fromPaper: string, toPaper: string, relation: RelationType): Promise<PaperRelation | null> {
    return (await this.list({ fromPaper, toPaper, relation }))[0] ?? null;
  }

  /** Upsert by id, else by (from, to, type); an edge moved to another source paper leaves the old one. */
  async save(relation: PaperRelation): Promise<void> {
    if (!(await this.papers.getById(relation.fromPaper))) {
      throw new NotFoundError(`No paper with id "${relation.fromPaper}".`);
    }
    const to = await this.links.linkFor({ paperId: relation.toPaper });
    if (!to) throw new NotFoundError(`No paper with id "${relation.toPaper}".`);
    const entry: RelationEntry = {
      to,
      type: relation.relation,
      id: relation.id,
      source: relation.source,
      "created-at": relation.createdAt,
    };
    if (relation.note) entry.note = relation.note;

    const previous = await this.getById(relation.id);
    if (previous && previous.fromPaper !== relation.fromPaper) await this.delete(relation.id);
    await this.edit(relation.fromPaper, (entries, read) => {
      const at = read.findIndex(
        (r) => r && (r.id === relation.id || (r.toPaper === relation.toPaper && r.relation === relation.relation)),
      );
      return at >= 0 ? entries.map((e, i) => (i === at ? entry : e)) : [...entries, entry];
    });
  }

  async delete(id: string): Promise<void> {
    const found = await this.getById(id);
    if (!found) return;
    await this.edit(found.fromPaper, (entries, read) => entries.filter((_, i) => read[i]?.id !== id));
  }

  /** Rewrites one paper's relations; `read[i]` is entry i as an edge, or null. */
  private async edit(
    paperId: string,
    change: (entries: RelationEntry[], read: (PaperRelation | null)[]) => RelationEntry[],
  ): Promise<void> {
    await this.papers.updateExtras(paperId, async ({ relations }) => ({
      relations: change(relations, await this.readEntries(paperId, relations)),
    }));
  }

  private async all(): Promise<PaperRelation[]> {
    const out: PaperRelation[] = [];
    for (const { paperId, extras } of await this.papers.listExtras()) {
      for (const r of await this.readEntries(paperId, extras.relations)) if (r) out.push(r);
    }
    return out;
  }

  private async readEntries(fromPaper: string, entries: readonly RelationEntry[]): Promise<(PaperRelation | null)[]> {
    const out: (PaperRelation | null)[] = [];
    for (const e of entries) {
      const type = e.type as RelationType;
      const toPaper = TYPES.includes(type) ? await this.targetOf(e.to) : null;
      if (!toPaper) {
        out.push(null);
        continue;
      }
      const relation: PaperRelation = {
        id: typeof e.id === "string" && e.id ? e.id : `${fromPaper}:${type}:${toPaper}`,
        fromPaper,
        toPaper,
        relation: type,
        source: e.source === "auto" ? "auto" : "manual",
        createdAt: typeof e["created-at"] === "string" ? e["created-at"] : "",
      };
      if (typeof e.note === "string" && e.note) relation.note = e.note;
      out.push(relation);
    }
    return out;
  }

  private async targetOf(to: unknown): Promise<string | null> {
    if (typeof to !== "string" || !to) return null;
    if (!to.startsWith("[[")) return to;
    const target = await this.links.resolve(to);
    return target && "paperId" in target ? target.paperId : null;
  }
}
