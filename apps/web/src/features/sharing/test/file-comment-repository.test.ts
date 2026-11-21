import { before, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { ConflictError, NotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { renderJsonRows } from "@/lib/json-rows-file";
import { FileCommentRepository } from "../infrastructure/file-comment-repository";

before(async () => {
  await loadTestCore();
});

const ROOT = "thesis";
const ITEMS: Record<string, string> = {
  "paper:p-1": "thesis/papers/Attention.paper.md",
  "paper:p-2": "thesis/papers/Other.paper.md",
  "note:n-1": "thesis/notes/Ideas.md",
};
const itemFileOf = async (type: string, id: string) => ITEMS[`${type}:${id}`] ?? null;

function repoOn(fs = new MemoryWorkspaceFs()) {
  return { fs, repo: new FileCommentRepository(fs, itemFileOf, ROOT) };
}

test("a comment sits next to its item, under the item's name; no id in the path", async () => {
  const { fs, repo } = repoOn();
  const comment = await repo.add({ resourceType: "paper", resourceId: "p-1", body: "Nice." });
  assert.match(comment.id, /^comment-/);
  assert.equal(comment.resourceType, "paper");
  assert.equal(comment.resourceId, "p-1");
  const rows = JSON.parse(await fs.readText("thesis/papers/Attention.comments.json"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, "Nice.");
  assert.equal("resourceId" in rows[0], false);
  await repo.add({ resourceType: "note", resourceId: "n-1", body: "Hm." });
  assert.ok(await fs.stat("thesis/notes/Ideas.comments.json"));
});

test("an unknown item lists nothing and add refuses it; no file is written", async () => {
  const { fs, repo } = repoOn();
  assert.deepEqual(await repo.list("paper", "nope"), []);
  await assert.rejects(repo.add({ resourceType: "paper", resourceId: "nope", body: "x" }), NotFoundError);
  assert.equal(await fs.stat(ROOT), null);
});

test("list is oldest first and keeps anchor and parentId", async () => {
  const { fs, repo } = repoOn();
  await fs.mkdirp("thesis/papers");
  await fs.writeFile(
    "thesis/papers/Attention.comments.json",
    renderJsonRows([
      { id: "c-2", authorId: "", body: "second", createdAt: "2026-02-02T00:00:00.000Z", parentId: "c-1" },
      { id: "c-1", authorId: "", body: "first", createdAt: "2026-01-01T00:00:00.000Z", anchor: { page: 3 } },
    ]),
  );
  const list = await repo.list("paper", "p-1");
  assert.deepEqual(list.map((c) => c.id), ["c-1", "c-2"]);
  assert.deepEqual(list[0]?.anchor, { page: 3 });
  assert.equal(list[1]?.parentId, "c-1");
});

test("remove and setResolved find the comment by its file; unknown ids change nothing", async () => {
  const { repo } = repoOn();
  const a = await repo.add({ resourceType: "paper", resourceId: "p-1", body: "a" });
  const b = await repo.add({ resourceType: "paper", resourceId: "p-2", body: "b" });
  const at = await repo.setResolved(b.id, true);
  assert.ok(at);
  assert.equal((await repo.list("paper", "p-2"))[0]?.resolvedAt, at);
  assert.equal(await repo.setResolved(b.id, false), null);
  assert.equal((await repo.list("paper", "p-2"))[0]?.resolvedAt, null);
  assert.equal(await repo.setResolved("missing", true), null);
  await repo.remove("missing");
  await repo.remove(a.id);
  assert.deepEqual(await repo.list("paper", "p-1"), []);
  assert.equal((await repo.list("paper", "p-2")).length, 1);
});

test("a comment id in two files is refused, not guessed", async () => {
  const { fs, repo } = repoOn();
  const row = { id: "c-1", authorId: "", body: "x", createdAt: "2026-01-01T00:00:00.000Z" };
  await fs.mkdirp("thesis/papers");
  await fs.writeFile("thesis/papers/Attention.comments.json", renderJsonRows([row]));
  await fs.writeFile("thesis/papers/Other.comments.json", renderJsonRows([row]));
  await assert.rejects(repo.remove("c-1"), ConflictError);
  await assert.rejects(repo.setResolved("c-1", true), ConflictError);
});

test("a broken comments file elsewhere does not block a remove", async () => {
  const { fs, repo } = repoOn();
  const a = await repo.add({ resourceType: "paper", resourceId: "p-1", body: "a" });
  await fs.writeFile("thesis/papers/Other.comments.json", "{ not json");
  await repo.remove(a.id);
  assert.deepEqual(await repo.list("paper", "p-1"), []);
  assert.equal(await fs.readText("thesis/papers/Other.comments.json"), "{ not json");
});

test("law: list returns exactly the added, not removed comments of that item", async () => {
  const op = fc.oneof(
    fc.record({ kind: fc.constant("add" as const), item: fc.constantFrom("p-1", "p-2"), body: fc.string() }),
    fc.record({ kind: fc.constant("remove" as const), pick: fc.nat() }),
  );
  await fc.assert(
    fc.asyncProperty(fc.array(op, { maxLength: 10 }), async (ops) => {
      const { repo } = repoOn();
      const model: Array<{ id: string; item: string; body: string }> = [];
      for (const step of ops) {
        if (step.kind === "add") {
          const c = await repo.add({ resourceType: "paper", resourceId: step.item, body: step.body });
          model.push({ id: c.id, item: step.item, body: step.body });
        } else if (model.length) {
          const [gone] = model.splice(step.pick % model.length, 1);
          await repo.remove(gone!.id);
        }
      }
      for (const item of ["p-1", "p-2"]) {
        const ids = (await repo.list("paper", item)).map((c) => c.id).sort();
        assert.deepEqual(ids, model.filter((m) => m.item === item).map((m) => m.id).sort());
      }
    }),
    { numRuns: 40 },
  );
});
