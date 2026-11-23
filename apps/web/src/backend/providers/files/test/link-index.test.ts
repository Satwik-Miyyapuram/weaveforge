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

test("(5c) an unreadable file is skipped by lookups, logged with its path, and the notes still resolve", async () => {
  const { fs, papers, index } = await setup();
  const realRead = fs.readText.bind(fs);
  fs.readText = async (path: string) => {
    if (path === `${papers}/x.paper.md`) throw new Error("EIO: read failed");
    return realRead(path);
  };
  const warned: unknown[][] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    const links = await index.snapshot();
    assert.deepEqual(links.unreadable, [{ path: `${papers}/x.paper.md`, reason: "EIO: read failed" }]);
    assert.equal(links.all().filter((e) => "vaultPageId" in e.target).length, 3, "the three notes still resolve");
    assert.equal(links.all().some((e) => "paperId" in e.target), false, "the unreadable paper is absent, not guessed");
    assert.ok(warned.some((args) => String(args[0]).includes(`${papers}/x.paper.md`)), "the unreadable path is logged");
  } finally {
    console.warn = realWarn;
  }
});

test("(P3) a bare link that an unreadable file could also name resolves to nothing, not to the readable match", async () => {
  const { fs, notes, index } = await setup();
  const unreadable = `${notes}/b/Untitled.note.md`;
  const realRead = fs.readText.bind(fs);
  fs.readText = async (path: string) => {
    if (path === unreadable) throw new Error("EIO: read failed");
    return realRead(path);
  };
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const links = await index.snapshot();
    assert.equal(links.resolve("[[Untitled.note]]"), null, "b is unreadable, so the bare name is ambiguous");
    assert.deepEqual(links.resolve("[[a/Untitled.note]]"), { vaultPageId: "n1" }, "the folder link names a alone");
  } finally {
    console.warn = realWarn;
  }
});

test("(P2) a file whose frontmatter cannot be parsed is reported unreadable, and its bare name stays ambiguous", async () => {
  const { fs, papers, index } = await setup();
  const broken = `${papers}/old/x.paper.md`;
  // An unclosed frontmatter block: the core refuses to parse it.
  await fs.writeFile(broken, "---\nweaveforge-id: p2\n");
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const links = await index.snapshot();
    assert.deepEqual(links.unreadable.map((u) => u.path), [broken], "the broken file is reported, not dropped silently");
    assert.match(links.unreadable[0]!.reason, /no frontmatter/, "the reason is the core's parse error");
    assert.equal(links.resolve("[[x.paper]]"), null, "the broken file could be named by the bare link, so it resolves to nothing");
    assert.deepEqual(links.resolve(`[[${papers}/x.paper]]`), { paperId: "p1" });
  } finally {
    console.warn = realWarn;
  }
});

test("(P2) linkFor writes the folder link when an unreadable file shares the name, so the link it writes resolves", async () => {
  const { fs, papers, index } = await setup();
  await fs.writeFile(`${papers}/old/x.paper.md`, "---\nweaveforge-id: p2\n");
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const links = await index.snapshot();
    const link = links.linkFor({ paperId: "p1" });
    assert.equal(link, `[[${papers}/x.paper]]`);
    assert.deepEqual(links.resolve(link as string), { paperId: "p1" }, "the written link round-trips");
  } finally {
    console.warn = realWarn;
  }
});
const BROKEN = "---\nweaveforge-id: p2\n";

async function quietly<T>(run: (warned: unknown[][]) => Promise<T>): Promise<T> {
  const warned: unknown[][] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    return await run(warned);
  } finally {
    console.warn = realWarn;
  }
}

test("(P3) linkFor returns null rather than a link that resolve() would refuse or send elsewhere", async () => {
  const { fs, papers, index } = await setup();
  // Its path ends with p1's whole path, so it could match p1's folder link too.
  await fs.writeFile(`${papers}/old/${papers}/x.paper.md`, BROKEN);
  await quietly(async () => {
    const links = await index.snapshot();
    assert.equal(links.resolve(`[[${papers}/x.paper]]`), null, "the folder link is ambiguous");
    assert.equal(links.linkFor({ paperId: "p1" }), null, "no link is written that would not read back");
  });
});

test("(P3) every link linkFor writes resolves back to its own target", async () => {
  const { fs, notes, papers, index } = await setup();
  await fs.writeFile(`${papers}/old/x.paper.md`, BROKEN);
  await quietly(async () => {
    const links = await index.snapshot();
    for (const { target } of links.all()) {
      const link = links.linkFor(target);
      assert.ok(link, `a link for ${JSON.stringify(target)}`);
      assert.deepEqual(links.resolve(link), target, `${link} reads back`);
    }
    assert.equal(links.linkFor({ vaultPageId: "n1" }), `[[${notes}/a/Untitled.note]]`);
  });
});

test("(P3) an unreadable file blocks the bare link in any case and with an alias; a folder link in another case still resolves", async () => {
  const { fs, papers, index } = await setup();
  await fs.writeFile(`${papers}/old/x.paper.md`, BROKEN);
  await quietly(async () => {
    const links = await index.snapshot();
    for (const link of ["[[x.paper]]", "[[X.PAPER]]", "[[x.paper|Alias]]", "[[X.Paper.md]]"]) {
      assert.equal(links.resolve(link), null, link);
    }
    assert.deepEqual(links.resolve(`[[${papers.toUpperCase()}/X.Paper|a]]`), { paperId: "p1" });
  });
});

test("(P3) an unreadable file is logged once, and again only when the set of unreadable files changes", async () => {
  const { fs, papers, index } = await setup();
  await fs.writeFile(`${papers}/old/x.paper.md`, BROKEN);
  await quietly(async (warned) => {
    await index.snapshot();
    await index.resolve("[[x.paper]]");
    await index.linkFor({ paperId: "p1" });
    await index.snapshot();
    assert.equal(warned.length, 1, "the same broken file is logged once");
    await fs.writeFile(`${papers}/old/y.paper.md`, BROKEN);
    await index.snapshot();
    assert.equal(warned.filter((w) => String(w[0]).includes("y.paper.md")).length, 1, "a newly broken file is logged");
    assert.equal(warned.filter((w) => String(w[0]).includes("old/x.paper.md")).length, 1, "the old one is not logged again");
  });
});