import { before, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { NewReaderAnnotation } from "@weaveforge/core";
import { ConflictError, NotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileReaderAnnotationRepository } from "../infrastructure/file-annotation-repository";

before(async () => {
  await loadTestCore();
});

const ROOT = "thesis";
const FILE = `${ROOT}/papers/Attention.annotations.json`;
const PAPERS: Record<string, string> = {
  "p-1": `${ROOT}/papers/Attention.paper.md`,
  "p-2": `${ROOT}/papers/Other.paper.md`,
};
const paperFileOf = async (paperId: string) => PAPERS[paperId] ?? null;

function draft(overrides: Partial<NewReaderAnnotation> = {}): NewReaderAnnotation {
  return {
    type: "highlight",
    color: "#ff0000",
    text: " quoted ",
    anchor: { rects: [], locus: null } as unknown as NewReaderAnnotation["anchor"],
    pageIndex: 2,
    ...overrides,
  };
}

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, repo: new FileReaderAnnotationRepository(fs, ROOT, paperFileOf) };
}

test("create writes the sidecar next to the paper file, under the paper's name", async () => {
  const { fs, repo } = setup();
  const made = await repo.create("p-1", draft({ id: "a1", color: " " }));
  assert.equal(made.color, "#ffd400");
  assert.equal(made.text, "quoted");
  assert.equal(made.syncState, "local");
  const rows = JSON.parse(await fs.readText(FILE)) as Array<{ id: string }>;
  assert.deepEqual(rows.map((r) => r.id), ["a1"]);
  assert.deepEqual(await repo.list("p-1"), [made]);
  assert.deepEqual(await repo.list("other"), []);
});

test("an unknown paper lists nothing and create refuses it; no file is written", async () => {
  const { fs, repo } = setup();
  assert.deepEqual(await repo.list("missing"), []);
  await assert.rejects(repo.create("missing", draft({ id: "a1" })), NotFoundError);
  assert.equal(await fs.stat(`${ROOT}/papers`), null);
});

test("a renamed paper file takes its annotations by name, never by id", async () => {
  const fs = new MemoryWorkspaceFs();
  const paths: Record<string, string> = { "p-1": `${ROOT}/papers/Attention.paper.md` };
  const repo = new FileReaderAnnotationRepository(fs, ROOT, async (id) => paths[id] ?? null);
  await repo.create("p-1", draft({ id: "a1" }));
  await fs.rename(FILE, `${ROOT}/papers/Renamed.annotations.json`);
  paths["p-1"] = `${ROOT}/papers/Renamed.paper.md`;
  assert.deepEqual((await repo.list("p-1")).map((a) => a.id), ["a1"]);
  await repo.update("a1", { comment: "x" });
  assert.equal(await fs.stat(FILE), null);
});

test("create rejects a bad type and a live id", async () => {
  const { repo } = setup();
  await assert.rejects(repo.create("p-1", draft({ type: "nope" as never })));
  await repo.create("p-1", draft({ id: "a1" }));
  await assert.rejects(repo.create("p-1", draft({ id: "a1" })), ConflictError);
});

test("update patches fields, marks pending; unknown id is NotFound", async () => {
  const { repo } = setup();
  await repo.create("p-1", draft({ id: "a1" }));
  const updated = await repo.update("a1", { comment: " note ", color: "#00ff00" });
  assert.equal(updated.comment, "note");
  assert.equal(updated.color, "#00ff00");
  assert.equal(updated.syncState, "pending");
  assert.deepEqual((await repo.list("p-1"))[0], updated);
  await assert.rejects(repo.update("missing", {}), NotFoundError);
});

test("remove deletes the row and keeps the others", async () => {
  const { repo } = setup();
  await repo.create("p-1", draft({ id: "a1" }));
  await repo.create("p-1", draft({ id: "a2" }));
  await repo.remove("a1");
  await repo.remove("missing");
  assert.deepEqual((await repo.list("p-1")).map((a) => a.id), ["a2"]);
});

test("an id in two annotations files: update and remove are refused, neither file changes", async () => {
  const { fs, repo } = setup();
  await repo.create("p-1", draft({ id: "a1" }));
  const other = `${ROOT}/papers/Other.annotations.json`;
  const text = await fs.readText(FILE);
  await fs.writeFile(other, text);
  await assert.rejects(repo.update("a1", { comment: "x" }), (error: unknown) => {
    assert.ok(error instanceof ConflictError);
    assert.ok(error.message.includes(FILE) && error.message.includes(other), error.message);
    return true;
  });
  await assert.rejects(repo.remove("a1"), ConflictError);
  assert.equal(await fs.readText(FILE), text);
  assert.equal(await fs.readText(other), text);
});

test("without a conditional write the repository refuses to write", async () => {
  const { fs, repo } = setup();
  Object.defineProperty(fs, "writeTextIf", { value: undefined });
  await assert.rejects(repo.create("p-1", draft({ id: "a1" })), /conditional write/i);
  assert.equal(await fs.stat(FILE), null);
});

test("list is sorted by sortIndex", async () => {
  const { repo } = setup();
  await repo.create("p-1", draft({ id: "z", pageIndex: 1 }));
  await repo.create("p-1", draft({ id: "a", pageIndex: 5 }));
  assert.deepEqual((await repo.list("p-1")).map((a) => a.id), ["z", "a"]);
});

test("unknown keys in a row survive an update", async () => {
  const { fs, repo } = setup();
  await repo.create("p-1", draft({ id: "a1" }));
  const rows = JSON.parse(await fs.readText(FILE)) as Array<Record<string, unknown>>;
  rows[0]!.extra = "kept";
  await fs.writeFile(FILE, JSON.stringify(rows));
  await repo.update("a1", { comment: "x" });
  assert.match(await fs.readText(FILE), /"extra": ?"kept"/);
});

/** A file system whose next conditional write first lets "another app" edit the file. */
class RacingFs extends MemoryWorkspaceFs {
  race: (() => Promise<void>) | null = null;

  override async writeTextIf(path: string, text: string, expected: string | null): Promise<boolean> {
    const race = this.race;
    this.race = null;
    if (race) await race();
    return super.writeTextIf(path, text, expected);
  }
}

// ---- Laws (fast-check) ----

const ids = fc.uniqueArray(fc.stringMatching(/^[a-f0-9]{1,6}$/), { minLength: 1, maxLength: 6 });

test("law: list(create(d)) contains the new annotation", async () => {
  await fc.assert(
    fc.asyncProperty(ids, async (made) => {
      const { repo } = setup();
      for (const id of made) await repo.create("p-1", draft({ id }));
      const listed = (await repo.list("p-1")).map((a) => a.id).sort();
      assert.deepEqual(listed, [...made].sort());
    }),
    { numRuns: 40 },
  );
});

test("law: an annotation written outside the app between read and write is never lost", async () => {
  await fc.assert(
    fc.asyncProperty(ids, fc.stringMatching(/^ext-[a-z]{1,6}$/), async (made, external) => {
      const fs = new RacingFs();
      const repo = new FileReaderAnnotationRepository(fs, ROOT, paperFileOf);
      for (const id of made) await repo.create("p-1", draft({ id }));
      fs.race = async () => {
        const rows = JSON.parse(await fs.readText(FILE)) as unknown[];
        rows.push({ id: external, type: "highlight", color: "#000", sortIndex: "0" });
        await fs.writeFile(FILE, JSON.stringify(rows));
      };
      await repo.create("p-1", draft({ id: "mine" }));
      const listed = (await repo.list("p-1")).map((a) => a.id);
      for (const id of [...made, external, "mine"]) assert.ok(listed.includes(id), `${id} kept`);
    }),
    { numRuns: 40 },
  );
});
