import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperRepository } from "../src/testing/in-memory-paper-repository.js";
import { InMemoryTagRepository, InMemoryPaperTagRepository } from "../src/testing/in-memory-tag-repository.js";
import { AddPaperUseCase } from "../src/features/papers/application/add-paper.use-case.js";
import { UpdatePaperUseCase } from "../src/features/papers/application/update-paper.use-case.js";
import { ManageTagsUseCase } from "../src/features/tags/application/manage-tags.use-case.js";
import type { Clock, IdGenerator } from "../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

function setup() {
  const repo = new InMemoryPaperRepository();
  const tagRepo = new InMemoryTagRepository();
  const paperTagRepo = new InMemoryPaperTagRepository();
  const manageTags = new ManageTagsUseCase({
    tags: tagRepo,
    paperTags: paperTagRepo,
    papers: repo,
    clock,
    ids: seqIds(),
  });
  const add = new AddPaperUseCase({ repository: repo, clock, ids: seqIds() });
  const update = new UpdatePaperUseCase({ repository: repo, tags: manageTags, clock });
  return { repo, add, update, manageTags, tags: tagRepo, paperTags: paperTagRepo };
}

test("setStatus changes only the status", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE", status: "to_read" });
  const updated = await update.setStatus(p.id, "read");
  assert.equal(updated.status, "read");
  assert.equal(updated.title, "VAE");
});

test("setStatus rejects unknown id", async () => {
  const { update } = setup();
  await assert.rejects(() => update.setStatus("nope", "read"));
});

test("remove deletes the paper", async () => {
  const { repo, add, update } = setup();
  const p = await add.addManual({ title: "Gone" });
  await update.remove(p.id);
  assert.equal(await repo.getById(p.id), null);
});

test("setRating validates range", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "Rated" });
  await assert.rejects(() => update.setRating(p.id, 9));
  const ok = await update.setRating(p.id, 4);
  assert.equal(ok.rating, 4);
});

test("addImage / removeImage track paths in metadata", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  const a = await update.addImage(p.id, "u1/p1/fig1.webp");
  const b = await update.addImage(p.id, "u1/p1/fig2.webp");
  assert.deepEqual(b.metadata?.images, ["u1/p1/fig1.webp", "u1/p1/fig2.webp"]);
  const c = await update.removeImage(p.id, "u1/p1/fig1.webp");
  assert.deepEqual(c.metadata?.images, ["u1/p1/fig2.webp"]);
  assert.ok(a);
});

test("addImage rejects empty path", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  await assert.rejects(() => update.addImage(p.id, "  "));
});

test("setSummary accepts long text (no word cap)", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  const long = Array.from({ length: 251 }, () => "disentanglement").join(" ");
  const ok = await update.setSummary(p.id, long);
  assert.equal(ok.summary, long);
});

test("setSummary clears with empty string and keeps markdown verbatim", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  const md = "**Key idea:** factorized posterior\n- MIG 0.41\n- `beta=4`";
  const s = await update.setSummary(p.id, md);
  assert.equal(s.summary, md);
  const cleared = await update.setSummary(p.id, "   ");
  assert.equal(cleared.summary, undefined);
});

test("setTags / mergeTags normalize and union", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  const a = await update.setTags(p.id, ["#Bayes", " vae ", "VAE", "generative"]);
  assert.deepEqual(a.tags.sort(), ["bayes", "generative", "vae"]);
  const b = await update.mergeTags(p.id, ["vae", "#latent"]);
  assert.deepEqual(b.tags.sort(), ["bayes", "generative", "latent", "vae"]);
});

test("extractHashtags pulls normalized tags from text", async () => {
  const { extractHashtags } = await import(
    "../src/features/papers/domain/paper.js"
  );
  assert.deepEqual(
    extractHashtags("Key #Disentanglement idea, see #beta-VAE and #beta-VAE again."),
    ["disentanglement", "beta-vae"],
  );
  assert.deepEqual(extractHashtags(undefined), []);
  assert.deepEqual(extractHashtags("no tags here"), []);
});

test("setIdentifiers normalizes a DOI URL down to the bare identifier", async () => {
  const { add, update } = setup();
  const paper = await add.addManual({ title: "Attention" });
  const saved = await update.setIdentifiers(paper.id, {
    doi: "  https://doi.org/10.1145/AbC  ",
  });
  assert.equal(saved.doi, "10.1145/abc");
});

test("setIdentifiers clears a field rather than storing an empty string", async () => {
  const { add, update } = setup();
  const paper = await add.addManual({ title: "VAE", arxivId: "1312.6114" });
  const cleared = await update.setIdentifiers(paper.id, { arxivId: "   " });
  // Citation tracking keys off `Boolean(doi || arxivId)`, so a blank string
  // here would make an untrackable paper look trackable.
  assert.equal(cleared.arxivId, undefined);
  assert.equal(Boolean(cleared.doi || cleared.arxivId), false);
});

test("setIdentifiers trims an arXiv id and leaves its case alone", async () => {
  const { add, update } = setup();
  const paper = await add.addManual({ title: "Paper" });
  const saved = await update.setIdentifiers(paper.id, { arxivId: " 2401.00001v2 " });
  assert.equal(saved.arxivId, "2401.00001v2");
});
