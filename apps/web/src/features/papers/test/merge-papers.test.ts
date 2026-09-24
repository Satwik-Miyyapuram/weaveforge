/**
 * Merging duplicate papers moves everything that points at the duplicate
 * before the duplicate goes, keeps a row Zotero knows, and removes the copies
 * Zotero holds twice from Zotero too, so a sync cannot bring them back.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Paper } from "@weaveforge/core";
import {
  InMemoryAnnotationPinRepository,
  InMemoryAnnotationQuotationTypeRepository,
  InMemoryPaperFieldRepository,
  InMemoryPaperRelationRepository,
  InMemoryPaperRepository,
  InMemoryReaderAnnotationRepository,
  InMemoryReadingListItemRepository,
} from "@weaveforge/core/testing";
import { MergePapersUseCase, PaperMergeRefusedError } from "../application/merge-papers.use-case";

function paper(id: string, over: Partial<Paper> = {}): Paper {
  return {
    id,
    title: `Paper ${id} with a long enough title`,
    authors: [],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

async function setup(opts: { bibliography?: { removeRemotePaper(key: string): Promise<void> } } = {}) {
  const deps = {
    papers: new InMemoryPaperRepository(),
    annotations: new InMemoryReaderAnnotationRepository(),
    pins: new InMemoryAnnotationPinRepository(),
    quotationTypes: new InMemoryAnnotationQuotationTypeRepository(),
    listItems: new InMemoryReadingListItemRepository(),
    fields: new InMemoryPaperFieldRepository(),
    relations: new InMemoryPaperRelationRepository(),
  };
  let n = 0;
  const merge = new MergePapersUseCase({ ...deps, ...opts, newId: () => `new-${++n}`, now: () => "2026-09-24T00:00:00Z" });
  return { ...deps, merge };
}

const anchor = { zoteroPosition: { pageIndex: 2, rects: [[0, 0, 1, 1]] } } as never;

test("everything pointing at the duplicate moves to the kept paper, then the duplicate goes", async () => {
  const s = await setup();
  await s.papers.save(paper("keep", { tags: ["a"] }));
  await s.papers.save(paper("dup", { doi: "10.1/x", tags: ["b"], pdfPath: "dup.pdf" }));
  await s.papers.save(paper("other"));

  const ann = await s.annotations.create("dup", { type: "highlight", color: "#ff0", text: "quote", anchor, pageIndex: 2 });
  await s.pins.save({ paperId: "dup", annotationKey: ann.id, reportSectionId: "sec" });
  await s.quotationTypes.save({ paperId: "dup", annotationKey: ann.id, quotationType: "claim" as never });

  await s.listItems.add({ id: "li1", listId: "L1", paperId: "dup", sortOrder: 0, note: "why" });
  await s.listItems.add({ id: "li2", listId: "L2", paperId: "dup", sortOrder: 0 });
  await s.listItems.add({ id: "li3", listId: "L2", paperId: "keep", sortOrder: 1 });

  await s.fields.setValue({ paperId: "dup", fieldId: "f1", value: { text: "from dup" } as never });
  await s.fields.setValue({ paperId: "dup", fieldId: "f2", value: { text: "loses" } as never });
  await s.fields.setValue({ paperId: "keep", fieldId: "f2", value: { text: "kept" } as never });

  const rel = (id: string, fromPaper: string, toPaper: string) => ({
    id, fromPaper, toPaper, relation: "cites" as never, source: "manual" as const, createdAt: "2026-01-01T00:00:00Z",
  });
  await s.relations.save(rel("r1", "dup", "other"));
  await s.relations.save(rel("r2", "keep", "dup"));

  const merged = await s.merge.execute("keep", ["keep", "dup"]);

  assert.equal(await s.papers.getById("dup"), null);
  assert.equal(merged.doi, "10.1/x");
  assert.equal(merged.pdfPath, "dup.pdf");
  assert.deepEqual([...merged.tags].sort(), ["a", "b"]);
  assert.deepEqual((await s.papers.getById("keep"))?.metadata["mergedFrom"], ["dup"]);

  const moved = await s.annotations.list("keep");
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.text, "quote");
  assert.deepEqual(await s.annotations.list("dup"), []);
  assert.deepEqual((await s.pins.listForPaper("keep")).map((p) => [p.annotationKey, p.reportSectionId]), [[moved[0]!.id, "sec"]]);
  assert.deepEqual(await s.pins.listForPaper("dup"), []);
  assert.equal((await s.quotationTypes.listForPaper("keep"))[0]?.annotationKey, moved[0]!.id);

  const lists = (await s.listItems.listsForPaper("keep")).map((i) => [i.listId, i.note ?? null]).sort();
  assert.deepEqual(lists, [["L1", "why"], ["L2", null]]);
  assert.deepEqual(await s.listItems.listsForPaper("dup"), []);

  const values = Object.fromEntries((await s.fields.listValuesForPaper("keep")).map((v) => [v.fieldId, v.value]));
  assert.deepEqual(values, { f1: { text: "from dup" }, f2: { text: "kept" } });

  const edges = (await s.relations.getGraph()).map((r) => `${r.fromPaper}->${r.toPaper}`);
  assert.deepEqual(edges, ["keep->other"], "re-pointed, and the keep↔dup edge dropped rather than made a self-loop");
});

test("the copy linked to Zotero survives, and the chosen copy's details fold into it", async () => {
  const s = await setup();
  await s.papers.save(paper("keep", { doi: "10.1/x" }));
  await s.papers.save(paper("zot", { metadata: { zoteroKey: "ABCD1234" } }));
  await s.listItems.add({ id: "li1", listId: "L1", paperId: "keep", sortOrder: 0 });

  const merged = await s.merge.execute("keep", ["keep", "zot"]);

  assert.equal(merged.id, "zot");
  assert.equal(merged.doi, "10.1/x");
  assert.equal(merged.metadata["zoteroKey"], "ABCD1234");
  assert.equal(await s.papers.getById("keep"), null);
  assert.equal((await s.listItems.listsForPaper("zot")).length, 1);
});

test("two copies linked to Zotero are refused when there is no way to remove one from Zotero", async () => {
  const s = await setup();
  await s.papers.save(paper("a", { metadata: { zoteroKey: "AAAA1111" } }));
  await s.papers.save(paper("b", { metadata: { zoteroKey: "BBBB2222" } }));
  await s.listItems.add({ id: "li1", listId: "L1", paperId: "b", sortOrder: 0 });

  await assert.rejects(s.merge.execute("a", ["a", "b"]), PaperMergeRefusedError);
  assert.ok(await s.papers.getById("b"));
  assert.equal((await s.listItems.listsForPaper("b")).length, 1);
  assert.equal((await s.papers.getById("a"))?.metadata["mergedFrom"], undefined);
});

test("two copies linked to Zotero: the chosen one stays, the other moves across and leaves Zotero too", async () => {
  const removed: string[] = [];
  const s = await setup({ bibliography: { removeRemotePaper: async (key) => void removed.push(key) } });
  await s.papers.save(paper("plain", { doi: "10.1/x" }));
  await s.papers.save(paper("a", { metadata: { zoteroKey: "AAAA1111" } }));
  await s.papers.save(paper("b", { metadata: { zoteroKey: "BBBB2222" } }));
  await s.listItems.add({ id: "li1", listId: "L1", paperId: "b", sortOrder: 0 });
  await s.annotations.create("b", { type: "highlight", color: "#ff0", text: "quote", anchor, pageIndex: 2 });

  const merged = await s.merge.execute("b", ["plain", "a", "b"]);

  assert.equal(merged.id, "b");
  assert.equal(merged.metadata["zoteroKey"], "BBBB2222");
  assert.equal(merged.doi, "10.1/x");
  assert.deepEqual(removed, ["AAAA1111"]);
  assert.equal(await s.papers.getById("a"), null);
  assert.equal(await s.papers.getById("plain"), null);
  assert.equal((await s.annotations.list("b")).length, 1);
  assert.equal((await s.listItems.listsForPaper("b")).length, 1);
});

test("when Zotero will not let go of a copy, the copy stays and a second run finishes", async () => {
  let reachable = false;
  const s = await setup({
    bibliography: {
      removeRemotePaper: async () => {
        if (!reachable) throw new Error("offline");
      },
    },
  });
  await s.papers.save(paper("a", { metadata: { zoteroKey: "AAAA1111" } }));
  await s.papers.save(paper("b", { metadata: { zoteroKey: "BBBB2222" } }));
  await s.listItems.add({ id: "li1", listId: "L1", paperId: "b", sortOrder: 0 });

  await assert.rejects(s.merge.execute("a", ["a", "b"]), /Zotero would not remove its copy \(offline\)/);
  assert.ok(await s.papers.getById("b"));
  assert.equal((await s.listItems.listsForPaper("a")).length, 1);

  reachable = true;
  const merged = await s.merge.execute("a", ["a", "b"]);
  assert.equal(merged.id, "a");
  assert.equal(await s.papers.getById("b"), null);
  assert.equal((await s.listItems.listsForPaper("a")).length, 1);
});

test("a paper that has gone is reported, not half-merged", async () => {
  const s = await setup();
  await s.papers.save(paper("keep"));
  await assert.rejects(s.merge.execute("keep", ["gone"]), /no longer in the library/);
});
