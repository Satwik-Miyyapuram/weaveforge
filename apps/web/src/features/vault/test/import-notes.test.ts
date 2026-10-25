import { test } from "node:test";
import assert from "node:assert/strict";

import { importNotesFromFiles, type ImportVault } from "../application/import-notes";

function md(path: string, body = "body"): File {
  const f = new File([body], path.split("/").pop()!);
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

/** A vault whose adds settle on a later tick, so overlap is observable. */
function fakeVault(opts: { failTitle?: string } = {}) {
  let inFlight = 0;
  let peak = 0;
  let loads = 0;
  const added: { title: string; parentId?: string; id: string }[] = [];
  const vault: ImportVault = {
    async pageTitles() {
      loads += 1;
      return ["Taken"];
    },
    manageVaultPage: {
      async add(input) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        if (input.title === opts.failTitle) throw new Error(`boom ${input.title}`);
        const id = `id-${added.length}`;
        added.push({ title: input.title, parentId: input.parentId, id });
        return { id };
      },
    },
  };
  return { vault, added, peak: () => peak, loads: () => loads };
}

test("importing N notes reads existing titles once and adds notes in parallel, bounded (34-24)", async () => {
  const fake = fakeVault();
  const files = Array.from({ length: 20 }, (_, i) => md(`root/n${i}.md`));
  const progress: number[] = [];
  const out = await importNotesFromFiles(files, (done) => progress.push(done), fake.vault);
  assert.equal(out.created, 20);
  assert.equal(fake.loads(), 1);
  assert.ok(fake.peak() > 1, `expected overlap, peak ${fake.peak()}`);
  assert.ok(fake.peak() <= 6, `expected a bound, peak ${fake.peak()}`);
  assert.deepEqual(progress, Array.from({ length: 20 }, (_, i) => i + 1));
});

test("folders are created before the notes inside them, parents first (34-24)", async () => {
  const fake = fakeVault();
  const out = await importNotesFromFiles(
    [md("root/a/b/deep.md"), md("root/a/top.md"), md("root/Taken.md")],
    undefined,
    fake.vault,
  );
  const byTitle = new Map(fake.added.map((p) => [p.title, p]));
  assert.equal(out.folders, 2);
  assert.equal(byTitle.get("b")!.parentId, byTitle.get("a")!.id);
  assert.equal(byTitle.get("deep")!.parentId, byTitle.get("b")!.id);
  assert.equal(byTitle.get("top")!.parentId, byTitle.get("a")!.id);
  // An existing title still gets a suffix.
  assert.deepEqual(out.renamed, [{ from: "Taken", to: "Taken (2)" }]);
});

test("a failed add rejects the import (34-24)", async () => {
  const fake = fakeVault({ failTitle: "n3" });
  const files = Array.from({ length: 8 }, (_, i) => md(`root/n${i}.md`));
  await assert.rejects(importNotesFromFiles(files, undefined, fake.vault), { message: "boom n3" });
});

test("an import with no notes adds nothing (34-24)", async () => {
  const fake = fakeVault();
  const out = await importNotesFromFiles([md("root/readme.txt")], undefined, fake.vault);
  assert.deepEqual(out, { created: 0, folders: 0, renamed: [], skipped: 1 });
  assert.equal(fake.added.length, 0);
});
