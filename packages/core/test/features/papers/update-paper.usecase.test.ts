import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";
import { InMemoryTagRepository, InMemoryPaperTagRepository } from "../../../src/testing/in-memory-tag-repository.js";
import { AddPaperUseCase } from "../../../src/features/papers/application/add-paper.use-case.js";
import { UpdatePaperUseCase } from "../../../src/features/papers/application/update-paper.use-case.js";
import { ManageTagsUseCase } from "../../../src/features/tags/application/manage-tags.use-case.js";
import { fixedClock, seqIds } from "../../../src/testing/fakes.js";
import { NotFoundError } from "../../../src/index.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");

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

test("mergeTags normalizes and unions through the tags use case", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  await update.mergeTags(p.id, ["#Bayes"]);
  const b = await update.mergeTags(p.id, ["VAE", "#latent", "vae"]);
  assert.deepEqual(b.tags.sort(), ["bayes", "latent", "vae"]);
});

test("extractHashtags pulls normalized tags from text", async () => {
  const { extractHashtags } = await import(
    "../../../src/features/papers/domain/paper.js"
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

test("setPdfSource keeps a typed PDF address as the paper's open-access copy", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "Found it" });
  const linked = await update.setPdfSource(p.id, "  https://repo.example/paper.pdf ");
  // The same field a metadata source fills, so the reader's ladder finds it.
  assert.equal(linked.metadata.openAccessPdf, "https://repo.example/paper.pdf");
  const cleared = await update.setPdfSource(p.id, "");
  assert.equal("openAccessPdf" in cleared.metadata, false);
});

test("setPdfSource refuses anything but https", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "Plain" });
  await assert.rejects(() => update.setPdfSource(p.id, "http://repo.example/paper.pdf"));
  await assert.rejects(() => update.setPdfSource(p.id, "file:///C:/paper.pdf"));
});

test("setTitle collapses whitespace and refuses a blank title", async () => {
  const { add, update } = setup();
  const paper = await add.addManual({ title: "Catalog Page draft" });
  const saved = await update.setTitle(paper.id, "  Attention   Is All\nYou Need ");
  assert.equal(saved.title, "Attention Is All You Need");
  await assert.rejects(update.setTitle(paper.id, "   "), /needs a title/);
});

/** Parks the next `getById(id)` until `release()`; resolves `reached` when it is parked. */
function gateGetById(repo: InMemoryPaperRepository, id: string) {
  const original = repo.getById.bind(repo);
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let reached!: () => void;
  const parked = new Promise<void>((r) => (reached = r));
  let armed = true;
  repo.getById = async (wanted: string) => {
    if (armed && wanted === id) {
      armed = false;
      reached();
      await open;
    }
    return original(wanted);
  };
  return { release, parked };
}

test("a note save and a status change at once both survive", async () => {
  const { repo, add, update } = setup();
  const p = await add.addManual({ title: "VAE", status: "to_read" });
  const gate = gateGetById(repo, p.id);
  const summary = update.setSummary(p.id, "my note");
  await gate.parked;
  const status = update.setStatus(p.id, "read");
  gate.release();
  await Promise.all([summary, status]);
  const stored = await repo.getById(p.id);
  assert.equal(stored?.status, "read");
  assert.equal(stored?.summary, "my note");
});

test("a status change returns the row with the earlier note", async () => {
  const { repo, add, update } = setup();
  const p = await add.addManual({ title: "VAE", status: "to_read" });
  const gate = gateGetById(repo, p.id);
  const summary = update.setSummary(p.id, "my note");
  await gate.parked;
  const status = update.setStatus(p.id, "read");
  gate.release();
  const [, returned] = await Promise.all([summary, status]);
  assert.equal(returned.status, "read");
  assert.equal(returned.summary, "my note");
});

test("updates to different papers do not wait for each other", async () => {
  const { repo, add, update } = setup();
  const a = await add.addManual({ title: "A" });
  const b = await add.addManual({ title: "B" });
  const gate = gateGetById(repo, a.id);
  const pending = update.setSummary(a.id, "held");
  await gate.parked;
  const other = await update.setStatus(b.id, "read");
  assert.equal(other.status, "read");
  gate.release();
  assert.equal((await pending).summary, "held");
});

test("a failed update does not block the next one", async () => {
  const { repo, add, update } = setup();
  await assert.rejects(update.setTitle("missing-id", "x"), /No paper/);
  await assert.rejects(update.setTitle("missing-id", "y"), /No paper/);
  const p = await add.addManual({ title: "VAE", status: "to_read" });
  const original = repo.getById.bind(repo);
  let calls = 0;
  repo.getById = async (wanted: string) => {
    if (calls++ === 0) throw new Error("disk");
    return original(wanted);
  };
  await assert.rejects(update.setStatus(p.id, "read"), /disk/);
  const next = await update.setStatus(p.id, "read");
  assert.equal(next.status, "read");
});

test("a remove waits for a parked update, which saves before the delete", async () => {
  const { repo, add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  const log: string[] = [];
  const originalSave = repo.save.bind(repo);
  repo.save = async (entity) => {
    log.push("save");
    return originalSave(entity);
  };
  const originalDelete = repo.delete.bind(repo);
  repo.delete = async (id: string) => {
    log.push("delete");
    return originalDelete(id);
  };
  const gate = gateGetById(repo, p.id);
  const title = update.setTitle(p.id, "New");
  await gate.parked;
  const removed = update.remove(p.id);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, []);
  gate.release();
  await Promise.all([title, removed]);
  assert.deepEqual(log, ["save", "delete"]);
  assert.equal(await repo.getById(p.id), null);
});

test("an update queued behind a remove fails with NotFound and does not write the row back", async () => {
  const { repo, add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  const removed = update.remove(p.id);
  const title = update.setTitle(p.id, "New");
  await removed;
  await assert.rejects(title, NotFoundError);
  assert.equal(await repo.getById(p.id), null);
  await new Promise((r) => setImmediate(r));
  const queues = (update as unknown as { queues: Map<string, unknown> }).queues;
  assert.equal(queues.size, 0);
});

test("the queue empties after the last update", async () => {
  const { add, update } = setup();
  const p = await add.addManual({ title: "VAE" });
  await update.setStatus(p.id, "read");
  await new Promise((r) => setImmediate(r));
  const queues = (update as unknown as { queues: Map<string, unknown> }).queues;
  assert.equal(queues.size, 0);
});
