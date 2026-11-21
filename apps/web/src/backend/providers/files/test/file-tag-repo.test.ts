import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FilePaperTagRepository, FileTagRepository, type SettingsSection } from "../file-tag-repo";

before(loadTestCore);

const ROOT = "thesis";

class MemorySettings implements SettingsSection {
  doc: Record<string, unknown> = {};
  get(key: readonly string[]): unknown {
    let cur: unknown = this.doc;
    for (const k of key) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
    return cur;
  }
  set(key: readonly string[], value: unknown): void {
    let obj = this.doc;
    for (const k of key.slice(0, -1)) obj = (obj[k] ??= {}) as Record<string, unknown>;
    const leaf = key[key.length - 1]!;
    if (value === undefined) delete obj[leaf];
    else obj[leaf] = value;
  }
}

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(`${ROOT}/papers/one.paper.md`, core.writePaperRow(null, { id: "p1", title: "One", tags: ["ml", "ünïcode"] }));
  await fs.writeFile(`${ROOT}/papers/two.paper.md`, core.writePaperRow(null, { id: "p2", title: "Two", tags: ["ml"] }));
  await fs.writeFile(`${ROOT}/papers/three.paper.md`, core.writePaperRow(null, { id: "p3", title: "Three" }));
  const papers = new FilePaperRepository(fs, ROOT);
  const settings = new MemorySettings();
  return { fs, papers, settings, tags: new FileTagRepository(papers, settings), links: new FilePaperTagRepository(papers) };
}

test("tags come from the papers' tags lists; a tag's id is its name", async () => {
  const { tags } = await setup();
  assert.deepEqual(await tags.list(), [{ id: "ml", name: "ml" }, { id: "ünïcode", name: "ünïcode" }]);
  assert.deepEqual(
    (await tags.listWithCounts()).map((t) => [t.name, t.paperCount]),
    [["ml", 2], ["ünïcode", 1]],
  );
  assert.deepEqual(await tags.getById("ml"), { id: "ml", name: "ml" });
  assert.deepEqual(await tags.findByName(" #ML "), { id: "ml", name: "ml" });
  assert.equal(await tags.getById("nope"), null);
  assert.deepEqual((await tags.listPapersForTag("ml")).sort(), ["p1", "p2"]);
  assert.deepEqual((await tags.listForPaper("p1")).map((t) => t.name), ["ml", "ünïcode"]);
  assert.deepEqual(await tags.listForPaper("missing"), []);
});

test("T4: a saved tag keeps its colour in settings and lists without papers", async () => {
  const { tags, settings } = await setup();
  await tags.save({ id: "ml", name: "ml", color: "#ff0000" });
  await tags.save({ id: "empty", name: "empty" });
  assert.deepEqual(await tags.getById("ml"), { id: "ml", name: "ml", color: "#ff0000" });
  assert.deepEqual(await tags.getById("empty"), { id: "empty", name: "empty" });
  assert.deepEqual(settings.doc, { tags: { ml: { color: "#ff0000" }, empty: {} } });
  assert.equal((await tags.listWithCounts()).find((t) => t.name === "empty")?.paperCount, 0);
});

test("save under a new name renames the tag in every paper; delete removes it everywhere", async () => {
  const { tags, papers, settings } = await setup();
  await tags.save({ id: "ml", name: "ml", color: "#00f" });
  await tags.save({ id: "ml", name: "Machine learning", color: "#00f" });
  assert.deepEqual((await papers.getById("p2"))?.tags, ["machine learning"]);
  assert.deepEqual(settings.doc, { tags: { "machine learning": { color: "#00f" } } });
  await tags.delete("machine learning");
  assert.deepEqual((await papers.getById("p1"))?.tags, ["ünïcode"]);
  assert.deepEqual(settings.doc, { tags: {} });
  assert.equal(await tags.getById("machine learning"), null);
});

test("setManualTags / mergeTags / removeManualTag write the paper file and return the paper", async () => {
  const { tags, fs } = await setup();
  const set = await tags.setManualTags("p3", ["#B", "a", "b", " "]);
  assert.deepEqual(set.tags, ["b", "a"]);
  assert.match(await fs.readText(`${ROOT}/papers/three.paper.md`), /tags: \["b","a"\]/);
  assert.deepEqual((await tags.mergeTags("p3", ["c", "A"])).tags, ["b", "a", "c"]);
  assert.deepEqual((await tags.removeManualTag("p3", "#A")).tags, ["b", "c"]);
  assert.deepEqual((await tags.reconcileSources("p3", [{ name: "d", source: "summary" }], ["summary"])).tags, ["b", "c", "d"]);
  assert.deepEqual(await tags.listPaperTagLinks("p3"), [
    { name: "b", source: "manual" },
    { name: "c", source: "manual" },
    { name: "d", source: "manual" },
  ]);
  assert.deepEqual((await tags.refreshPaperCache("p3")).tags, ["b", "c", "d"]);
  await assert.rejects(tags.setManualTags("missing", ["x"]));
});

test("mergeConcepts folds one tag into another without duplicates", async () => {
  const { tags, papers, settings } = await setup();
  await tags.save({ id: "ünïcode", name: "ünïcode", color: "#111" });
  await tags.mergeConcepts("ml", "ünïcode");
  assert.deepEqual((await papers.getById("p1"))?.tags, ["ml"]);
  assert.deepEqual((await tags.list()).map((t) => t.name), ["ml"]);
  assert.equal(settings.get(["tags", "ünïcode"]), undefined);
});

test("paper-tag links read as manual links and write through the paper file", async () => {
  const { links, papers } = await setup();
  assert.deepEqual(await links.listForPaper("p2"), [{ paperId: "p2", tagId: "ml", source: "manual" }]);
  assert.deepEqual((await links.listForTag("ml")).map((l) => l.paperId).sort(), ["p1", "p2"]);
  assert.equal((await links.listAll()).length, 3);
  await links.link({ paperId: "p3", tagId: "new", source: "zotero_item" });
  await links.link({ paperId: "p3", tagId: "new", source: "manual" });
  assert.deepEqual((await papers.getById("p3"))?.tags, ["new"]);
  await links.unlink("p3", "new");
  assert.deepEqual((await papers.getById("p3"))?.tags, []);
  await links.reconcile("p1", [{ paperId: "p1", tagId: "x", source: "manual" }], ["manual"]);
  assert.deepEqual((await papers.getById("p1"))?.tags, ["x"]);
  await links.reconcile("p1", [{ paperId: "p1", tagId: "y", source: "zotero_item" }], ["zotero_item"]);
  assert.deepEqual((await papers.getById("p1"))?.tags, ["x", "y"]);
  await links.unlinkBySource("p1", "zotero_item");
  assert.deepEqual((await papers.getById("p1"))?.tags, ["x", "y"]);
  await links.unlinkBySource("p1", "manual");
  assert.deepEqual((await papers.getById("p1"))?.tags, []);
  await links.link({ paperId: "missing", tagId: "x", source: "manual" }).then(
    () => assert.fail("expected a refusal"),
    () => undefined,
  );
});

test("a hand-typed tags block list reads; an empty papers folder has no tags", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(`${ROOT}/papers/hand.paper.md`, "---\nweaveforge-id: h\nweaveforge-type: paper\ntags:\n  - Foo\n  - bar\n---\nBody\n");
  const tags = new FileTagRepository(new FilePaperRepository(fs, ROOT), new MemorySettings());
  assert.deepEqual((await tags.listForPaper("h")).map((t) => t.name), ["foo", "bar"]);
  const empty = new FileTagRepository(new FilePaperRepository(new MemoryWorkspaceFs(), ROOT), new MemorySettings());
  assert.deepEqual(await empty.list(), []);
});
