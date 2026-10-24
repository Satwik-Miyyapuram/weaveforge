/**
 * `BrowserWorkspaceFs.remove` over a stand-in for the File System Access API.
 * Only a missing entry is "already gone"; any other refusal is a failed delete
 * and must reach the caller (29-05).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BrowserWorkspaceFs } from "../infrastructure/browser-workspace-fs";

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
  async createWritable() {
    return {
      write: async (data: string | Uint8Array) => {
        this.bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      },
      close: async () => undefined,
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

test("recursive remove still clears a folder", async () => {
  const { fs } = workspace();
  await fs.writeFile("project/notes/a.md", "x");
  await fs.remove("project", { recursive: true });
  assert.equal(await fs.stat("project/notes/a.md"), null);
});
