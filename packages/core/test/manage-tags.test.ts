import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageTagsUseCase,
  type Paper,
  type Tag,
  type PaperTag,
  type TagSource,
  type ITagRepository,
  type IPaperTagRepository,
  type IPaperRepository,
} from "../src/index.js";

class FakeTagRepo implements ITagRepository {
  readonly rows = new Map<string, Tag>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByName(name: string) {
    return [...this.rows.values()].find((t) => t.name === name) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async listWithCounts() {
    return [...this.rows.values()].map((t) => ({ ...t, paperCount: 0 }));
  }
  async save(tag: Tag) {
    this.rows.set(tag.id, tag);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}

class FakePaperTagRepo implements IPaperTagRepository {
  links: PaperTag[] = [];
  async listForPaper(paperId: string) {
    return this.links.filter((l) => l.paperId === paperId);
  }
  async listForTag(tagId: string) {
    return this.links.filter((l) => l.tagId === tagId);
  }
  async listAll() {
    return [...this.links];
  }
  async link(link: PaperTag) {
    if (!this.links.some((l) => l.paperId === link.paperId && l.tagId === link.tagId && l.source === link.source)) {
      this.links.push(link);
    }
  }
  async unlink(paperId: string, tagId: string, source?: TagSource) {
    this.links = this.links.filter(
      (l) => !(l.paperId === paperId && l.tagId === tagId && (source === undefined || l.source === source)),
    );
  }
  async unlinkBySource(paperId: string, source: TagSource) {
    this.links = this.links.filter((l) => !(l.paperId === paperId && l.source === source));
  }
  async reconcile(paperId: string, links: PaperTag[], sources: readonly TagSource[]) {
    this.links = this.links.filter((l) => !(l.paperId === paperId && sources.includes(l.source)));
    this.links.push(...links);
  }
}

class FakePaperRepo implements IPaperRepository {
  readonly rows = new Map<string, Paper>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(p: Paper) {
    this.rows.set(p.id, p);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async findByArxivId() {
    return null;
  }
  async findByDoi() {
    return null;
  }
}

function makeSetup() {
  const tags = new FakeTagRepo();
  const paperTags = new FakePaperTagRepo();
  const papers = new FakePaperRepo();
  papers.rows.set("p1", { id: "p1", title: "P1", authors: [], status: "to_read", tags: [], metadata: {}, createdAt: "t", updatedAt: "t" } as Paper);
  let n = 0;
  const uc = new ManageTagsUseCase({
    tags,
    paperTags,
    papers,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `tag-${++n}` },
  });
  return { tags, paperTags, papers, uc };
}

test("setManualTags: creates tags, links them, and refreshes the paper cache", async () => {
  const { papers, paperTags, uc } = makeSetup();
  const paper = await uc.setManualTags("p1", ["ml", "  NLP  "]);
  assert.deepEqual(paper.tags.sort(), ["ml", "nlp"]);
  assert.equal((await paperTags.listForPaper("p1")).length, 2);
  assert.deepEqual((papers.rows.get("p1")!.tags).sort(), ["ml", "nlp"]);
});

test("setManualTags: replacing removes dropped manual tags", async () => {
  const { paperTags, uc } = makeSetup();
  await uc.setManualTags("p1", ["a", "b"]);
  const paper = await uc.setManualTags("p1", ["b", "c"]);
  assert.deepEqual(paper.tags.sort(), ["b", "c"]);
  assert.equal((await paperTags.listForPaper("p1")).length, 2);
});

test("mergeTags: unions with existing tags of that source", async () => {
  const { uc } = makeSetup();
  await uc.setManualTags("p1", ["a"]);
  const paper = await uc.mergeTags("p1", ["b"]);
  assert.deepEqual(paper.tags.sort(), ["a", "b"]);
});

test("removeManualTag: unlinks one manual tag, keeps the rest", async () => {
  const { uc } = makeSetup();
  await uc.setManualTags("p1", ["keep", "drop"]);
  const paper = await uc.removeManualTag("p1", "drop");
  assert.deepEqual(paper.tags, ["keep"]);
});

test("reuses an existing tag row rather than creating a duplicate", async () => {
  const { tags, uc } = makeSetup();
  await uc.setManualTags("p1", ["shared"]);
  const countAfterFirst = tags.rows.size;
  await uc.mergeTags("p1", ["shared"]);
  assert.equal(tags.rows.size, countAfterFirst);
});
