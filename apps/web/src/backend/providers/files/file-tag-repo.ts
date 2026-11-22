/**
 * Tags from files (0.9.7 L3). Same contract as the `tags` / `paper_tags` repos;
 * laws in test/file-tag-repo.test.ts.
 *
 * - A paper's tags are the `tags:` list in its frontmatter; the tag list is every
 *   name some paper uses plus every tag saved in `.weaveforge/settings.json` under
 *   `tags` (`{ "<name>": { "color": "#hex" } }`), which is where a colour lives.
 * - A tag's id is its normalized name (`normalizeTags`: trimmed, no `#`, lower case).
 * - Files keep names only, so every link reads as `manual`. A write from another
 *   source adds its names; it never removes a name, since the file cannot say
 *   which source a name came from.
 */
import {
  NotFoundError,
  type IPaperTagRepository,
  type ITagManager,
  type ITagRepository,
  type Paper,
  type PaperTag,
  type Tag,
  type TagSource,
  type TagSourceItem,
  type TagWithPaperCount,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** The slice of the workspace settings file this needs (`WorkspaceSettingsFile`). */
export interface SettingsSection {
  get(key: readonly string[]): unknown;
  set(key: readonly string[], value: unknown): void;
}

/** The slice of the paper repository this needs (`FilePaperRepository`). */
export interface TaggedPapers {
  getById(id: string): Promise<Paper | null>;
  list(): Promise<Paper[]>;
  setTags(id: string, tags: string[], updatedAt: string): Promise<void>;
}

const TAGS = "tags";

function normalize(names: readonly string[]): string[] {
  return readyCore().normalizeTags([...names]);
}

function tagsOf(paper: Paper): string[] {
  return normalize(paper.tags ?? []);
}

/** Read, change and write one paper's tags; refuses a paper that does not exist. */
async function editTags(papers: TaggedPapers, paperId: string, change: (tags: string[]) => string[]): Promise<Paper> {
  const paper = await papers.getById(paperId);
  if (!paper) throw new NotFoundError(`No paper with id "${paperId}".`);
  const before = tagsOf(paper);
  const after = normalize(change(before));
  if (JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(paper.tags) === JSON.stringify(after)) {
    return paper;
  }
  await papers.setTags(paperId, after, new Date().toISOString());
  return (await papers.getById(paperId)) ?? { ...paper, tags: after };
}

export class FileTagRepository implements ITagRepository, ITagManager {
  constructor(
    private readonly papers: TaggedPapers,
    private readonly settings: SettingsSection,
  ) {}

  async getById(id: string): Promise<Tag | null> {
    return (await this.list()).find((t) => t.id === id) ?? null;
  }

  async findByName(name: string): Promise<Tag | null> {
    const [key] = normalize([name]);
    return key === undefined ? null : this.getById(key);
  }

  async list(): Promise<Tag[]> {
    return (await this.listWithCounts()).map(({ paperCount: _n, ...tag }) => tag);
  }

  listAll(): Promise<Tag[]> {
    return this.list();
  }

  async listWithCounts(): Promise<TagWithPaperCount[]> {
    const counts = new Map<string, number>();
    for (const name of Object.keys(this.saved())) counts.set(name, 0);
    for (const paper of await this.papers.list()) {
      for (const name of tagsOf(paper)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, paperCount]) => ({ ...this.tag(name), paperCount }));
  }

  /** Saves the colour; a new name for an existing id renames the tag everywhere. */
  async save(tag: Tag): Promise<void> {
    const [name] = normalize([tag.name]);
    if (name === undefined) throw new Error("A tag needs a name.");
    if (tag.id !== name && (await this.getById(tag.id))) {
      await this.renameEverywhere(tag.id, name);
      this.settings.set([TAGS, tag.id], undefined);
    }
    this.settings.set([TAGS, name], tag.color ? { color: tag.color } : {});
  }

  async delete(id: string): Promise<void> {
    for (const paperId of await this.listPapersForTag(id)) {
      await editTags(this.papers, paperId, (tags) => tags.filter((t) => t !== id));
    }
    this.settings.set([TAGS, id], undefined);
  }

  async listForPaper(paperId: string): Promise<Tag[]> {
    const paper = await this.papers.getById(paperId);
    return paper ? tagsOf(paper).map((name) => this.tag(name)) : [];
  }

  async listPapersForTag(tagId: string): Promise<string[]> {
    return (await this.papers.list()).filter((p) => tagsOf(p).includes(tagId)).map((p) => p.id);
  }

  async listPaperTagLinks(paperId: string): Promise<readonly { name: string; source: TagSource }[]> {
    return (await this.listForPaper(paperId)).map((t) => ({ name: t.name, source: "manual" as const }));
  }

  setManualTags(paperId: string, rawNames: string[]): Promise<Paper> {
    return editTags(this.papers, paperId, () => rawNames);
  }

  mergeTags(paperId: string, rawNames: string[]): Promise<Paper> {
    return editTags(this.papers, paperId, (tags) => [...tags, ...rawNames]);
  }

  removeManualTag(paperId: string, rawName: string): Promise<Paper> {
    const drop = new Set(normalize([rawName]));
    return editTags(this.papers, paperId, (tags) => tags.filter((t) => !drop.has(t)));
  }

  reconcileSources(paperId: string, items: readonly TagSourceItem[], sources: readonly TagSource[]): Promise<Paper> {
    const names = items.map((i) => i.name);
    return editTags(this.papers, paperId, (tags) => (sources.includes("manual") ? names : [...tags, ...names]));
  }

  async mergeConcepts(keepTagId: string, dropTagId: string): Promise<void> {
    await this.renameEverywhere(dropTagId, keepTagId);
    this.settings.set([TAGS, dropTagId], undefined);
  }

  async refreshPaperCache(paperId: string): Promise<Paper> {
    const paper = await this.papers.getById(paperId);
    if (!paper) throw new NotFoundError(`No paper with id "${paperId}".`);
    return paper;
  }

  private async renameEverywhere(from: string, to: string): Promise<void> {
    for (const paperId of await this.listPapersForTag(from)) {
      await editTags(this.papers, paperId, (tags) => tags.map((t) => (t === from ? to : t)));
    }
  }

  private saved(): Record<string, unknown> {
    const raw = this.settings.get([TAGS]);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  }

  private tag(name: string): Tag {
    const color = (this.saved()[name] as { color?: unknown } | undefined)?.color;
    return typeof color === "string" && color ? { id: name, name, color } : { id: name, name };
  }
}

export class FilePaperTagRepository implements IPaperTagRepository {
  constructor(private readonly papers: TaggedPapers) {}

  async listForPaper(paperId: string): Promise<PaperTag[]> {
    const paper = await this.papers.getById(paperId);
    return paper ? linksOf(paper) : [];
  }

  async listForTag(tagId: string): Promise<PaperTag[]> {
    return (await this.listAll()).filter((l) => l.tagId === tagId);
  }

  async listAll(): Promise<PaperTag[]> {
    return (await this.papers.list()).flatMap(linksOf);
  }

  async link(link: PaperTag): Promise<void> {
    await editTags(this.papers, link.paperId, (tags) => [...tags, link.tagId]);
  }

  async unlink(paperId: string, tagId: string): Promise<void> {
    await editTags(this.papers, paperId, (tags) => tags.filter((t) => t !== tagId));
  }

  async unlinkBySource(paperId: string, source: TagSource): Promise<void> {
    if (source === "manual") await editTags(this.papers, paperId, () => []);
  }

  async reconcile(paperId: string, links: PaperTag[], sources: readonly TagSource[]): Promise<void> {
    const names = links.map((l) => l.tagId);
    await editTags(this.papers, paperId, (tags) => (sources.includes("manual") ? names : [...tags, ...names]));
  }
}

function linksOf(paper: Paper): PaperTag[] {
  return tagsOf(paper).map((tagId) => ({ paperId: paper.id, tagId, source: "manual" as const }));
}
