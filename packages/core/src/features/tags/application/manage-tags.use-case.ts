/**
 * Tag / concept membership use-cases. Writes paper_tags and keeps papers.tags[]
 * as a denormalized cache for filters and legacy callers.
 */

import { normalizeTags } from "../../papers/domain/paper.js";
import type { Paper } from "../../papers/domain/paper.js";
import type { IPaperRepository } from "../../papers/domain/paper-repository.js";
import { normalizeTagName, type PaperTag, type Tag, type TagSource } from "../domain/tag.js";
import type { ITagRepository, IPaperTagRepository } from "../domain/tag-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export interface ManageTagsDeps {
  tags: ITagRepository;
  paperTags: IPaperTagRepository;
  papers: IPaperRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageTagsUseCase {
  constructor(private readonly deps: ManageTagsDeps) {}

  async listAll(): Promise<Tag[]> {
    return this.deps.tags.list();
  }

  async listWithCounts() {
    return this.deps.tags.listWithCounts();
  }

  async listForPaper(paperId: string): Promise<Tag[]> {
    const links = await this.deps.paperTags.listForPaper(paperId);
    const out: Tag[] = [];
    for (const l of links) {
      const t = await this.deps.tags.getById(l.tagId);
      if (t) out.push(t);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listPapersForTag(tagId: string): Promise<string[]> {
    const links = await this.deps.paperTags.listForTag(tagId);
    return [...new Set(links.map((l) => l.paperId))];
  }

  /** Tag memberships on a paper with resolved names (for UI source-aware editing). */
  async listPaperTagLinks(
    paperId: string,
  ): Promise<readonly { name: string; source: TagSource }[]> {
    const links = await this.deps.paperTags.listForPaper(paperId);
    const out: { name: string; source: TagSource }[] = [];
    for (const l of links) {
      const t = await this.deps.tags.getById(l.tagId);
      if (t) out.push({ name: t.name, source: l.source });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Replace manual tags on a paper. */
  async setManualTags(paperId: string, rawNames: string[]): Promise<Paper> {
    const names = normalizeTags(rawNames);
    await this.reconcileSources(
      paperId,
      names.map((name) => ({ name, source: "manual" as const })),
      ["manual"],
    );
    return this.refreshPaperCache(paperId);
  }

  /** Union tags into a paper for a given source (legacy mergeTags). */
  async mergeTags(paperId: string, rawNames: string[], source: TagSource = "manual"): Promise<Paper> {
    const names = normalizeTags(rawNames);
    const existing = await this.listTagNamesForPaper(paperId, source);
    const merged = normalizeTags([...existing, ...names]);
    await this.reconcileSources(
      paperId,
      merged.map((name) => ({ name, source })),
      [source],
    );
    return this.refreshPaperCache(paperId);
  }

  /** Remove one manual tag by name; synced tags are untouched. */
  async removeManualTag(paperId: string, rawName: string): Promise<Paper> {
    const name = normalizeTagName(rawName);
    if (!name) return this.refreshPaperCache(paperId);
    const links = (await this.deps.paperTags.listForPaper(paperId)).filter(
      (l) => l.source === "manual",
    );
    for (const l of links) {
      const t = await this.deps.tags.getById(l.tagId);
      if (t?.name === name) {
        await this.deps.paperTags.unlink(paperId, l.tagId, "manual");
        break;
      }
    }
    return this.refreshPaperCache(paperId);
  }

  /**
   * Replace all links from the given sources with the supplied tag names.
   * Used by Zotero annotation sync (reconcile, not union-only).
   */
  async reconcileSources(
    paperId: string,
    items: readonly { name: string; source: TagSource; annotationRef?: string }[],
    sources: readonly TagSource[],
  ): Promise<Paper> {
    const links: PaperTag[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const name = normalizeTagName(item.name);
      if (!name) continue;
      const key = `${name}:${item.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tag = await this.getOrCreateTag(name);
      links.push({
        paperId,
        tagId: tag.id,
        source: item.source,
        annotationRef: item.annotationRef,
      });
    }
    await this.deps.paperTags.reconcile(paperId, links, sources);
    return this.refreshPaperCache(paperId);
  }

  /** Merge one tag into another; reassign links and delete the alias tag. */
  async mergeConcepts(keepTagId: string, dropTagId: string): Promise<void> {
    if (keepTagId === dropTagId) return;
    const dropLinks = await this.deps.paperTags.listForTag(dropTagId);
    for (const l of dropLinks) {
      await this.deps.paperTags.link({ ...l, tagId: keepTagId });
      await this.deps.paperTags.unlink(l.paperId, dropTagId, l.source);
    }
    await this.deps.tags.delete(dropTagId);
    const paperIds = [...new Set(dropLinks.map((l) => l.paperId))];
    for (const pid of paperIds) await this.refreshPaperCache(pid);
  }

  private async listTagNamesForPaper(paperId: string, source: TagSource): Promise<string[]> {
    const links = (await this.deps.paperTags.listForPaper(paperId)).filter((l) => l.source === source);
    const names: string[] = [];
    for (const l of links) {
      const t = await this.deps.tags.getById(l.tagId);
      if (t) names.push(t.name);
    }
    return names;
  }

  private async getOrCreateTag(name: string): Promise<Tag> {
    const existing = await this.deps.tags.findByName(name);
    if (existing) return existing;
    const tag: Tag = { id: this.deps.ids.newId(), name };
    await this.deps.tags.save(tag);
    return tag;
  }

  private async refreshPaperCache(paperId: string): Promise<Paper> {
    const paper = await this.deps.papers.getById(paperId);
    if (!paper) throw new Error(`No paper with id "${paperId}".`);
    const tags = await this.listForPaper(paperId);
    const names = normalizeTags(tags.map((t) => t.name)).sort();
    const updated: Paper = { ...paper, tags: names, updatedAt: this.deps.clock.nowIso() };
    await this.deps.papers.save(updated);
    return updated;
  }
}
