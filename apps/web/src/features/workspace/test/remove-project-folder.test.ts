import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";

import { typedCore } from "@/lib/rust-core";
import { removeProjectFolder } from "../application/parts";

/** 0.9.8: a project is its folder, so the id is the folder name. */
const project = { id: "ZZ verify 082", name: "ZZ verify 082" };

/** Every path under `.weaveforge/trash/`, without the day folder. */
function trashed(fs: MemoryWorkspaceFs): string[] {
  return Object.keys(fs.toRecord())
    .filter((path) => path.startsWith(".weaveforge/trash/"))
    .map((path) => path.split("/").slice(3).join("/"))
    .sort();
}

test("moves the project's folder to the trash and leaves the rest", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("ZZ verify 082/notes/a.md", "x");
  await fs.writeFile("thesis--2a3407/notes/b.md", "y");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  assert.equal(await fs.stat("ZZ verify 082/notes/a.md"), null);
  assert.equal(await fs.stat("ZZ verify 082"), null);
  assert.deepEqual(trashed(fs), ["ZZ verify 082/notes/a.md"]);
  assert.notEqual(await fs.stat("thesis--2a3407/notes/b.md"), null);
});

test("leaves everything when no folder matches", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("thesis--2a3407/notes/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), null);
  assert.notEqual(await fs.stat("thesis--2a3407/notes/a.md"), null);
});

test("a folder of another name is never taken, even an old --id6 one", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("zz-verify-082--ac0e9a/notes/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), null);
  assert.notEqual(await fs.stat("zz-verify-082--ac0e9a/notes/a.md"), null);
  assert.deepEqual(trashed(fs), []);
});

test("a user-made folder without the standard subfolders still goes to the trash whole", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("ZZ verify 082/photo.jpg", "img");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  assert.deepEqual(trashed(fs), ["ZZ verify 082/photo.jpg"]);
});

test("a file, a dot folder or a nested path named as the project is never taken", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("ZZ verify 082", "a file");
  await fs.writeFile(".weaveforge/x.json", "{}");
  await fs.writeFile("a/b/c.md", "c");
  assert.equal(await removeProjectFolder(fs, project), null);
  assert.equal(await removeProjectFolder(fs, { id: ".weaveforge", name: ".weaveforge" }), null);
  assert.equal(await removeProjectFolder(fs, { id: "a/b", name: "b" }), null);
  assert.equal(await fs.readText("ZZ verify 082"), "a file");
  assert.equal(await fs.readText("a/b/c.md"), "c");
});

test("F97-P1-1: a second removal the same day does not overwrite the first in the trash", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("ZZ verify 082/notes/a.md", "first");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  await fs.writeFile("ZZ verify 082/notes/a.md", "second");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  const texts = Object.entries(fs.toRecord())
    .filter(([path]) => path.startsWith(".weaveforge/trash/"))
    .map(([, text]) => text)
    .sort();
  assert.deepEqual(texts, ["first", "second"]);
});

/** Writes `late` into the tree just before the first remove: a file that lands after the walk. */
class LateWriteFs extends MemoryWorkspaceFs {
  constructor(private late: string | null) {
    super();
  }

  override async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.late) {
      const late = this.late;
      this.late = null;
      await this.writeFile(late, "late");
    }
    return super.remove(path, options);
  }
}

test("F97-P2-1: a file that appears after the walk survives the folder removal", async () => {
  const fs = new LateWriteFs("ZZ verify 082/notes/late.md");
  await fs.writeFile("ZZ verify 082/notes/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  assert.equal(await fs.readText("ZZ verify 082/notes/late.md"), "late");
  assert.equal(await fs.stat("ZZ verify 082/notes/a.md"), null);
  assert.deepEqual(trashed(fs), ["ZZ verify 082/notes/a.md"]);
});

test("F97-P2-1: emptied folders are removed bottom-up once nothing is left in them", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("ZZ verify 082/notes/deep/a.md", "x");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  assert.equal(await fs.stat("ZZ verify 082/notes/deep"), null);
  assert.equal(await fs.stat("ZZ verify 082/notes"), null);
  assert.equal(await fs.stat("ZZ verify 082"), null);
});

test("F97-P1-2: an empty subfolder inside the project is removed with it", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("ZZ verify 082/notes/a.md", "x");
  await fs.mkdirp("ZZ verify 082/empty/inner");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  assert.equal(await fs.stat("ZZ verify 082/empty"), null);
  assert.equal(await fs.stat("ZZ verify 082"), null);
});

/** Records every remove call, so a test can assert no recursive remove was ever used. */
class RecordingFs extends MemoryWorkspaceFs {
  readonly removes: { path: string; recursive: boolean }[] = [];

  override async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.removes.push({ path, recursive: options?.recursive === true });
    return super.remove(path, options);
  }
}

test("F97-P1-2: folders are removed without recursion, and a folder that still holds a file is kept without a log", async () => {
  const fs = new LateWriteFs("ZZ verify 082/notes/late.md");
  await fs.writeFile("ZZ verify 082/notes/a.md", "x");
  await fs.mkdirp("ZZ verify 082/empty");
  const logged: { level: string; message: string }[] = [];
  const window = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    weaveforge: {
      fetchTitle: () => undefined,
      reportAppLog: (entry: { level: string; message: string }) => logged.push(entry),
    },
  };
  try {
    assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  } finally {
    (globalThis as { window?: unknown }).window = window;
  }
  assert.equal(await fs.readText("ZZ verify 082/notes/late.md"), "late");
  assert.equal(await fs.stat("ZZ verify 082/empty"), null);
  assert.equal(logged.length, 0);
});

test("F97-P1-2: the folder removal never asks for a recursive remove", async () => {
  const fs = new RecordingFs();
  await fs.writeFile("ZZ verify 082/notes/deep/a.md", "x");
  await fs.mkdirp("ZZ verify 082/empty");
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  assert.ok(fs.removes.length > 0);
  assert.equal(fs.removes.every((call) => !call.recursive), true);
});

/** Throws `failure` when asked to remove the notes folder, as the desktop does for a folder it cannot remove. */
class FailingRemoveFs extends MemoryWorkspaceFs {
  constructor(private readonly failure: Error) {
    super();
  }

  override async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (path === "ZZ verify 082/notes") throw this.failure;
    return super.remove(path, options);
  }
}

function coded(code: string): Error {
  return Object.assign(new Error(`${code}: ZZ verify 082/notes`), { code });
}

/** Runs a removal whose removal of the notes folder throws `failure`; returns what was logged. */
async function logsWhenRemovalFails(failure: Error): Promise<{ level: string; message: string }[]> {
  const fs = new FailingRemoveFs(failure);
  await fs.writeFile("ZZ verify 082/notes/a.md", "x");
  const logged: { level: string; message: string }[] = [];
  const window = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    weaveforge: {
      fetchTitle: () => undefined,
      reportAppLog: (entry: { level: string; message: string }) => logged.push(entry),
    },
  };
  try {
    await removeProjectFolder(fs, project);
  } finally {
    (globalThis as { window?: unknown }).window = window;
  }
  return logged;
}

test("F97-P2-3: a folder that is not empty when removed is kept without a log", async () => {
  assert.deepEqual(await logsWhenRemovalFails(coded("ENOTEMPTY")), []);
});

test("F97-P2-3: a folder already gone when removed is kept without a log", async () => {
  assert.deepEqual(await logsWhenRemovalFails(coded("ENOENT")), []);
});

test("0.9.8: a browser folder that is not empty (InvalidModificationError) is kept without a log", async () => {
  const failure = new DOMException("The directory is not empty.", "InvalidModificationError") as unknown as Error;
  assert.deepEqual(await logsWhenRemovalFails(failure), []);
});

test("0.9.8: a browser folder already gone (NotFoundError) is kept without a log", async () => {
  const failure = new DOMException("A requested file or directory could not be found.", "NotFoundError") as unknown as Error;
  assert.deepEqual(await logsWhenRemovalFails(failure), []);
});

test("F97-P2-3: any other failure to remove a folder is logged", async () => {
  const logged = await logsWhenRemovalFails(coded("EACCES"));
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.level, "warn");
  assert.match(logged[0]!.message, /ZZ verify 082\/notes/);
});

test("a trash of the same folder name landing during this one keeps both trees", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("ZZ verify 082/notes/a.md", "mine");
  const mkdirp = fs.mkdirp.bind(fs);
  let raced = false;
  fs.mkdirp = async (dir) => {
    await mkdirp(dir);
    if (raced) return;
    raced = true;
    // Another trash of a folder with this name takes the first trash name now.
    const other = typedCore().trashPathFor("ZZ verify 082", Date.now(), 1);
    await fs.writeFile(`${other}/notes/a.md`, "the other trash");
  };
  assert.equal(await removeProjectFolder(fs, project), "ZZ verify 082");
  const texts = await Promise.all(
    Object.keys(fs.toRecord())
      .filter((path) => path.startsWith(".weaveforge/trash/"))
      .map((path) => fs.readText(path)),
  );
  assert.deepEqual(texts.sort(), ["mine", "the other trash"]);
});