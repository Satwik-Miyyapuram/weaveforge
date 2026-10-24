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
} from "../../../src/index.js";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";

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

const P1: Paper = { id: "p1", title: "P1", authors: [], status: "to_read", tags: [], metadata: {}, createdAt: "t", updatedAt: "t" };

function makeSetup() {
  const tags = new FakeTagRepo();
  const paperTags = new FakePaperTagRepo();
  const papers = new InMemoryPaperRepository();
  void papers.save(P1);
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
  assert.deepEqual((await papers.getById("p1"))!.tags.sort(), ["ml", "nlp"]);
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

test("refreshing the tag cache writes only the tags, so an edit made meanwhile is kept", async () => {
  // The cache was written back as the whole row read moments earlier, which
  // reverted any edit that landed in between (here: the summary).
  const { papers, paperTags, uc } = makeSetup();
  const listForPaper = paperTags.listForPaper.bind(paperTags);
  paperTags.listForPaper = async (paperId) => {
    await papers.save({ ...P1, summary: "Edited meanwhile", updatedAt: "t2" });
    return listForPaper(paperId);
  };

  const paper = await uc.setManualTags("p1", ["ml"]);

  const stored = await papers.getById("p1");
  assert.equal(stored?.summary, "Edited meanwhile");
  assert.deepEqual(stored?.tags, ["ml"]);
  assert.equal(stored?.updatedAt, "2026-07-23T09:00:00.000Z");
  assert.deepEqual(paper, stored, "the returned paper is the stored row");
});

test("refreshing the tag cache of a paper deleted meanwhile does not bring it back", async () => {
  const { papers, paperTags, uc } = makeSetup();
  const listForPaper = paperTags.listForPaper.bind(paperTags);
  paperTags.listForPaper = async (paperId) => {
    await papers.delete("p1");
    return listForPaper(paperId);
  };

  await assert.rejects(uc.setManualTags("p1", ["ml"]), /No paper with id "p1"/);
  assert.equal(await papers.getById("p1"), null);
});

test("tag lookups for a paper run once per tag and in parallel (05-01)", async () => {
  const { tags, paperTags, uc } = makeSetup();
  await uc.setManualTags("p1", ["a", "b", "c"]);
  // The same tag linked from a second source must not be fetched twice.
  const first = (await paperTags.listForPaper("p1"))[0]!;
  await paperTags.link({ ...first, source: "summary" });

  const real = tags.getById.bind(tags);
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  tags.getById = async (id: string) => {
    calls += 1;
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return real(id);
  };

  const listed = await uc.listForPaper("p1");
  assert.deepEqual(listed.map((t) => t.name), ["a", "b", "c"]);
  assert.equal(calls, 3);
  assert.equal(maxInFlight, 3);

  calls = 0;
  const links = await uc.listPaperTagLinks("p1");
  assert.equal(links.length, 4);
  assert.equal(calls, 3);

  await uc.removeManualTag("p1", "c");
  assert.deepEqual((await uc.listForPaper("p1")).map((t) => t.name), ["a", "b"]);
});

test("a link to a deleted tag is skipped (05-01)", async () => {
  const { tags, uc } = makeSetup();
  await uc.setManualTags("p1", ["a", "b"]);
  const b = await tags.findByName("b");
  tags.rows.delete(b!.id);
  assert.deepEqual((await uc.listForPaper("p1")).map((t) => t.name), ["a"]);
  assert.deepEqual((await uc.listPaperTagLinks("p1")).map((l) => l.name), ["a"]);
});
