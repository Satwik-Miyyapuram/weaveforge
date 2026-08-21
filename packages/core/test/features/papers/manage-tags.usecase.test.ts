import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";
import { InMemoryTagRepository, InMemoryPaperTagRepository } from "../../../src/testing/in-memory-tag-repository.js";
import { AddPaperUseCase } from "../../../src/features/papers/application/add-paper.use-case.js";
import { ManageTagsUseCase } from "../../../src/features/tags/application/manage-tags.use-case.js";
import type { Clock, IdGenerator } from "../../../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

function setup() {
  const papers = new InMemoryPaperRepository();
  const tags = new InMemoryTagRepository();
  const paperTags = new InMemoryPaperTagRepository();
  const uc = new ManageTagsUseCase({ tags, paperTags, papers, clock, ids: seqIds() });
  const add = new AddPaperUseCase({ repository: papers, clock, ids: seqIds() });
  return { papers, paperTags, tags, uc, add };
}

test("reconcileSources replaces zotero_annotation tags", async () => {
  const { paperTags, uc, add } = setup();
  const p = await add.addManual({ title: "A" });
  await uc.reconcileSources(
    p.id,
    [{ name: "vae", source: "zotero_annotation" }, { name: "beta", source: "zotero_annotation" }],
    ["zotero_annotation"],
  );
  let links = await paperTags.listForPaper(p.id);
  assert.equal(links.length, 2);
  await uc.reconcileSources(p.id, [{ name: "vae", source: "zotero_annotation" }], ["zotero_annotation"]);
  links = await paperTags.listForPaper(p.id);
  assert.equal(links.length, 1);
});

test("manual and zotero_annotation sources coexist", async () => {
  const { uc, add } = setup();
  const p = await add.addManual({ title: "B" });
  await uc.mergeTags(p.id, ["manual-tag"], "manual");
  await uc.reconcileSources(p.id, [{ name: "zotero", source: "zotero_annotation" }], ["zotero_annotation"]);
  const updated = await uc.listForPaper(p.id);
  assert.deepEqual(updated.map((t) => t.name).sort(), ["manual-tag", "zotero"]);
});

test("mergeConcepts reassigns links", async () => {
  const { tags, paperTags, uc, add } = setup();
  const p = await add.addManual({ title: "C" });
  await uc.mergeTags(p.id, ["vae"], "manual");
  const all = await tags.list();
  const vae = all.find((t) => t.name === "vae")!;
  const alias = { id: "alias-1", name: "variational-autoencoder" };
  await tags.save(alias);
  await paperTags.link({ paperId: p.id, tagId: alias.id, source: "manual" });
  await uc.mergeConcepts(vae.id, alias.id);
  const remaining = await tags.list();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]!.name, "vae");
});

test("removeManualTag unlinks manual only", async () => {
  const { uc, add, paperTags } = setup();
  const p = await add.addManual({ title: "D" });
  await uc.mergeTags(p.id, ["manual-one"], "manual");
  await uc.reconcileSources(
    p.id,
    [{ name: "zotero-one", source: "zotero_annotation" }],
    ["zotero_annotation"],
  );
  const updated = await uc.removeManualTag(p.id, "manual-one");
  assert.deepEqual(updated.tags, ["zotero-one"]);
  const links = await paperTags.listForPaper(p.id);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.source, "zotero_annotation");
});
