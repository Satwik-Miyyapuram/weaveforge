import assert from "node:assert/strict";
import test, { before } from "node:test";
import { NotFoundError, type ScreeningDecision } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileScreeningRepository, type ListFile, type ListFilesPort } from "../file-screening-repository";

before(async () => {
  await loadTestCore();
});

/** An in-memory folder of list files; `write` checks the hash like the shell does. */
function memoryPort(files: Record<string, string>, itemsByFile: Record<string, string[]>) {
  const texts = new Map(Object.entries(files));
  const hash = (text: string) => `h${text.length}:${text}`;
  const writes: string[] = [];
  const port: ListFilesPort = {
    async listFiles(): Promise<ListFile[]> {
      return [...texts].map(([path, text]) => ({ path, text, hash: hash(text) }));
    },
    async fileForItem(itemId: string): Promise<ListFile | null> {
      const path = Object.keys(itemsByFile).find((p) => itemsByFile[p]!.includes(itemId));
      const text = path === undefined ? undefined : texts.get(path);
      return path === undefined || text === undefined ? null : { path, text, hash: hash(text) };
    },
    async write(path: string, text: string, expectedHash: string): Promise<void> {
      const now = texts.get(path);
      if (now === undefined || hash(now) !== expectedHash) throw new Error("changed on disk");
      texts.set(path, text);
      writes.push(path);
    },
  };
  return { port, texts, writes };
}

const LIST = "---\nwf: 3\ntitle: Review\n---\nWhy.\n";

function decision(id: string, itemId: string, state: ScreeningDecision["state"], at: string): ScreeningDecision {
  return { id, itemId, reviewerId: "r1", stage: "title_abstract", state, decidedAt: at };
}

test("a recorded decision is written to its list file and read back", async () => {
  const { port, texts } = memoryPort({ "lists/a.md": LIST }, { "lists/a.md": ["i1"] });
  const repo = new FileScreeningRepository(port);
  const d = decision("d1", "i1", "included", "2026-11-19T10:00:00Z");
  await repo.record(d);
  assert.match(texts.get("lists/a.md")!, /^---\nwf: 3\ntitle: Review\nitems:\n {2}- \{"id":"d1"/);
  assert.ok(texts.get("lists/a.md")!.endsWith("---\nWhy.\n"));
  assert.deepEqual(await repo.listForItems(["i1"]), [d]);
});

test("listForItems gives the latest decision per item, reviewer and stage, and only the asked items", async () => {
  const { port } = memoryPort({ "a.md": LIST, "b.md": LIST }, { "a.md": ["i1"], "b.md": ["i2"] });
  const repo = new FileScreeningRepository(port);
  const later = decision("d2", "i1", "excluded", "2026-11-19T11:00:00Z");
  await repo.record(later);
  await repo.record(decision("d1", "i1", "unsure", "2026-11-19T10:00:00Z"));
  await repo.record(decision("d3", "i2", "included", "2026-11-19T10:00:00Z"));
  assert.deepEqual(await repo.listForItems(["i1"]), [later]);
  assert.deepEqual(await repo.listForItems([]), []);
});

test("remove takes the id out of every file that holds it, not only the first", async () => {
  const { port, texts } = memoryPort({ "a.md": LIST, "b.md": LIST }, { "a.md": ["i1"] });
  const repo = new FileScreeningRepository(port);
  await repo.record(decision("d1", "i1", "included", "2026-11-19T10:00:00Z"));
  texts.set("b.md", texts.get("a.md")!);
  await repo.remove("d1");
  assert.ok(!texts.get("a.md")!.includes('"id":"d1"'));
  assert.ok(!texts.get("b.md")!.includes('"id":"d1"'), "the second file keeps the removed id");
});

test("a damaged list file is reported, not silently skipped", async () => {
  const damaged = "---\nwf: 3\nitems:\n  - {\"not\":\"a decision\"}\n---\n";
  const { port } = memoryPort({ "bad.md": damaged, "good.md": LIST }, { "good.md": ["i1"] });
  const repo = new FileScreeningRepository(port);
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await repo.listForItems(["i1"]);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]![0]), /bad\.md/);
});

test("remove takes the entry out of whichever file holds it", async () => {
  const { port, texts } = memoryPort({ "a.md": LIST, "b.md": LIST }, { "a.md": ["i1"], "b.md": ["i2"] });
  const repo = new FileScreeningRepository(port);
  await repo.record(decision("d1", "i2", "included", "2026-11-19T10:00:00Z"));
  await repo.remove("d1");
  assert.equal(texts.get("b.md"), LIST);
  await repo.remove("not-there");
});

test("one damaged list file does not break screening in the others", async () => {
  const damaged = "---\nwf: 3\nitems:\n  - {\"not\":\"a decision\"}\n---\n";
  const { port, texts } = memoryPort({ "bad.md": damaged, "good.md": LIST }, { "good.md": ["i1"] });
  const repo = new FileScreeningRepository(port);
  const d = decision("d1", "i1", "included", "2026-11-19T10:00:00Z");
  await repo.record(d);
  assert.deepEqual(await repo.listForItems(["i1"]), [d]);
  await repo.remove("d1");
  assert.equal(texts.get("good.md"), LIST);
  assert.equal(texts.get("bad.md"), damaged, "the damaged file is never written");
});

test("an item in no list file is refused", async () => {
  const { port } = memoryPort({ "a.md": LIST }, { "a.md": [] });
  const repo = new FileScreeningRepository(port);
  await assert.rejects(repo.record(decision("d1", "gone", "included", "2026-11-19T10:00:00Z")), NotFoundError);
});

test("a newer-format list is never written", async () => {
  const newer = "---\nwf: 4\ntitle: Future\n---\n";
  const { port, texts, writes } = memoryPort({ "a.md": newer }, { "a.md": ["i1"] });
  const repo = new FileScreeningRepository(port);
  await assert.rejects(repo.record(decision("d1", "i1", "included", "2026-11-19T10:00:00Z")), /newer WeaveForge/);
  assert.equal(texts.get("a.md"), newer);
  assert.deepEqual(writes, []);
});

test("a file changed on disk since it was read is not overwritten", async () => {
  const { port, texts } = memoryPort({ "a.md": LIST }, { "a.md": ["i1"] });
  const racing: ListFilesPort = {
    ...port,
    async fileForItem(itemId) {
      const file = await port.fileForItem(itemId);
      texts.set("a.md", `${LIST}edited elsewhere\n`);
      return file;
    },
  };
  const repo = new FileScreeningRepository(racing);
  await assert.rejects(repo.record(decision("d1", "i1", "included", "2026-11-19T10:00:00Z")), /changed on disk/);
  assert.equal(texts.get("a.md"), `${LIST}edited elsewhere\n`);
});
