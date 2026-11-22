import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { readyCore, typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { LinkIndex } from "../link-index";

before(loadTestCore);

const ROOT = "thesis";

class CountingFs extends MemoryWorkspaceFs {
  walks = 0;
  override walk(dir: string) {
    this.walks += 1;
    return super.walk(dir);
  }
}

function note(id: string): string {
  return `---\nweaveforge-id: ${id}\nweaveforge-type: vault_page\n---\nBody\n`;
}

async function setup() {
  const fs = new CountingFs();
  const notes = readyCore().entityDir("vault_page", ROOT);
  const papers = readyCore().entityDir("paper", ROOT);
  await fs.writeFile(`${notes}/a/Untitled.note.md`, note("n1"));
  await fs.writeFile(`${notes}/b/Untitled.note.md`, note("n2"));
  await fs.writeFile(`${notes}/Ünïque.note.md`, note("n3"));
  await fs.writeFile(`${papers}/x.paper.md`, typedCore().writePaperRow(null, { id: "p1", title: "X" }));
  return { fs, notes, papers, index: new LinkIndex(fs, () => ROOT) };
}

test("a unique name links bare; a folder-qualified link to it still resolves", async () => {
  const { index, papers } = await setup();
  assert.equal(await index.linkFor({ paperId: "p1" }), "[[x.paper]]");
  assert.deepEqual(await index.resolve("[[x.paper]]"), { paperId: "p1" });
  assert.deepEqual(await index.resolve(`[[${papers}/x.paper]]`), { paperId: "p1" });
  assert.deepEqual(await index.resolve("[[ünïque.note|alias]]"), { vaultPageId: "n3" });
});

test("two files with one name link by folder, resolve by folder, and a bare link is refused", async () => {
  const { index, notes } = await setup();
  const one = await index.linkFor({ vaultPageId: "n1" });
  const two = await index.linkFor({ vaultPageId: "n2" });
  assert.equal(one, `[[${notes}/a/Untitled.note]]`);
  assert.equal(two, `[[${notes}/b/Untitled.note]]`);
  assert.deepEqual(await index.resolve(one!), { vaultPageId: "n1" });
  assert.deepEqual(await index.resolve(two!), { vaultPageId: "n2" });
  assert.deepEqual(await index.resolve("[[b/untitled.note]]"), { vaultPageId: "n2" });
  assert.equal(await index.resolve("[[Untitled.note]]"), null);
});

test("a snapshot walks the folders once for any number of lookups", async () => {
  const { fs, index } = await setup();
  const links = await index.snapshot();
  const walks = fs.walks;
  for (let i = 0; i < 5; i++) {
    links.resolve("[[x.paper]]");
    links.linkFor({ vaultPageId: "n1" });
  }
  assert.equal(fs.walks, walks);
  assert.deepEqual(links.resolve("[[x.paper]]"), { paperId: "p1" });
});

test("an empty folder resolves nothing", async () => {
  const index = new LinkIndex(new MemoryWorkspaceFs(), () => ROOT);
  assert.equal(await index.resolve("[[x.paper]]"), null);
  assert.equal(await index.linkFor({ paperId: "p1" }), null);
  assert.equal(await index.resolve("not a link"), null);
});
