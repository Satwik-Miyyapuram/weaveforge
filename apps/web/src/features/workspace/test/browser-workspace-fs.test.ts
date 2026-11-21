/**
 * `BrowserWorkspaceFs.remove` over a stand-in for the File System Access API.
 * Only a missing entry is "already gone"; any other refusal is a failed delete
 * and must reach the caller (29-05).
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

import fc from "fast-check";

import { loadTestCore } from "@/lib/test/load-test-core";

import { BrowserWorkspaceFs } from "../infrastructure/parts";

before(async () => {
  await loadTestCore();
});

type Entry = FakeDir | FakeFile;

class FakeFile {
  readonly kind = "file";
  constructor(public bytes: Uint8Array = new Uint8Array()) {}
  async getFile() {
    const bytes = this.bytes;
    return {
      size: bytes.byteLength,
      lastModified: 0,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }
  /** Set to make the next write fail this way (a full disk, say). */
  failWrite: DOMException | null = null;
  aborted = 0;
  /** Like the browser: writes go to a swap file that only `close` makes real. */
  async createWritable() {
    let staged: Uint8Array | null = null;
    return {
      write: async (data: string | Uint8Array) => {
        const failure = this.failWrite;
        this.failWrite = null;
        staged = new Uint8Array(0);
        if (failure) throw failure;
        staged = typeof data === "string" ? new TextEncoder().encode(data) : data;
      },
      close: async () => {
        if (staged) this.bytes = staged;
      },
      abort: async () => {
        this.aborted++;
        staged = null;
      },
    };
  }
}

const notFound = () => new DOMException("A requested file or directory could not be found.", "NotFoundError");

class FakeDir {
  readonly kind = "directory";
  readonly children = new Map<string, Entry>();
  /** Set to make the next removeEntry fail this way. */
  refuse: DOMException | null = null;

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let entry = this.children.get(name);
    if (!entry && options?.create) this.children.set(name, (entry = new FakeDir()));
    if (!(entry instanceof FakeDir)) throw notFound();
    return entry;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let entry = this.children.get(name);
    if (!entry && options?.create) this.children.set(name, (entry = new FakeFile()));
    if (!(entry instanceof FakeFile)) throw notFound();
    return entry;
  }
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (this.refuse) throw this.refuse;
    const entry = this.children.get(name);
    if (!entry) throw notFound();
    if (entry instanceof FakeDir && entry.children.size > 0 && !options?.recursive) {
      throw new DOMException("The directory is not empty.", "InvalidModificationError");
    }
    this.children.delete(name);
  }
  async *entries(): AsyncIterableIterator<[string, Entry]> {
    yield* this.children.entries();
  }
}

function workspace() {
  const root = new FakeDir();
  return { root, fs: new BrowserWorkspaceFs(root as never) };
}

test("removing a file that is already gone is not an error", async () => {
  const { fs } = workspace();
  await fs.mkdirp("notes");
  await fs.remove("notes/gone.md");
  await fs.remove("no-such-dir/gone.md");
});

test("a non-empty folder removed without recursive is a failed delete (29-05)", async () => {
  const { fs } = workspace();
  await fs.writeFile("notes/a.md", "x");
  await assert.rejects(() => fs.remove("notes"), { name: "InvalidModificationError" });
  assert.equal(await fs.readText("notes/a.md"), "x");
});

test("a delete the browser refuses reaches the caller (29-05)", async () => {
  const { root, fs } = workspace();
  await fs.writeFile("a.md", "x");
  root.refuse = new DOMException("Not allowed.", "NoModificationAllowedError");
  await assert.rejects(() => fs.remove("a.md"), { name: "NoModificationAllowedError" });
});

test("a rename whose delete fails says so rather than leaving two copies quietly (29-05)", async () => {
  const { root, fs } = workspace();
  await fs.writeFile("old.md", "body");
  root.refuse = new DOMException("Not allowed.", "NoModificationAllowedError");
  await assert.rejects(() => fs.rename("old.md", "new.md"));
});

test("a write the disk refuses keeps the old bytes and reaches the caller (opfs_quota_exceeded)", async () => {
  const { root, fs } = workspace();
  await fs.writeFile("a.md", "old body");
  const file = root.children.get("a.md") as FakeFile;
  file.failWrite = new DOMException("Quota exceeded.", "QuotaExceededError");
  await assert.rejects(() => fs.writeFile("a.md", "new body"), { name: "QuotaExceededError" });
  assert.equal(await fs.readText("a.md"), "old body");
  assert.equal(file.aborted, 1);
});

// A file changed since the caller read it is refused and left alone, as the desktop
// adapter refuses (the shell's checked write). Without this, note and milestone saves
// overwrite an external edit.
test("writeTextIf writes only while the file still reads as the caller last saw it", async () => {
  const { fs } = workspace();
  await fs.writeFile("notes/a.md", "read");
  assert.equal(await fs.writeTextIf("notes/a.md", "app", "edited outside"), false);
  assert.equal(await fs.readText("notes/a.md"), "read");
  assert.equal(await fs.writeTextIf("notes/a.md", "app", "read"), true);
  assert.equal(await fs.readText("notes/a.md"), "app");
});

test("writeTextIf with expected null writes only while the file is still missing", async () => {
  const { fs } = workspace();
  await fs.writeFile("notes/a.md", "someone else's");
  assert.equal(await fs.writeTextIf("notes/a.md", "app", null), false);
  assert.equal(await fs.readText("notes/a.md"), "someone else's");
  assert.equal(await fs.writeTextIf("notes/new.md", "app", null), true);
  assert.equal(await fs.readText("notes/new.md"), "app");
});

/** Stand-in for the Web Locks API: one holder per name at a time, in request order. */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  return {
    names,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(callback);
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
}

// Two tabs saving the same note both read the old text before either writes; a lock
// per path makes the read, compare and write one step, so only one of them wins.
test("concurrent writeTextIf calls on one path let exactly one through (Web Lock per path)", async () => {
  const locks = fakeLocks();
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true, writable: true });
  try {
    const { fs } = workspace();
    await fs.writeFile("notes/a.md", "base");
    const results = await Promise.all([
      fs.writeTextIf("notes/a.md", "tab one", "base"),
      fs.writeTextIf("notes/a.md", "tab two", "base"),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(locks.names.length, 2);
    assert.equal(new Set(locks.names).size, 1);
    assert.ok(locks.names[0]?.includes("notes/a.md"));
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});

test("recursive remove still clears a folder", async () => {
  const { fs } = workspace();
  await fs.writeFile("project/notes/a.md", "x");
  await fs.remove("project", { recursive: true });
  assert.equal(await fs.stat("project/notes/a.md"), null);
});

test("law: the last write to each path is what a read returns", async () => {
  const segment = fc.constantFrom("a", "b", "notes", "x.md");
  const path = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"));
  await fc.assert(
    fc.asyncProperty(fc.array(fc.tuple(path, fc.uint8Array({ maxLength: 64 })), { maxLength: 20 }), async (writes) => {
      const { fs } = workspace();
      const last = new Map<string, Uint8Array>();
      for (const [at, bytes] of writes) {
        // A path that is already a folder, or under a file, is refused; skip those.
        try {
          await fs.writeFile(at, bytes);
          last.set(at, bytes);
        } catch {
          continue;
        }
      }
      for (const [at, bytes] of last) assert.deepEqual([...(await fs.readFile(at))], [...bytes]);
    }),
  );
});
