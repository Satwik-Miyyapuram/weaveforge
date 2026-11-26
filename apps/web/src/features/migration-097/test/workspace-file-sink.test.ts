import { test } from "node:test";
import assert from "node:assert/strict";

import { workspaceFileSink, type OpfsLike } from "../infrastructure/workspace-file-sink";

/** In-memory stand-in for BrowserWorkspaceFs, with the same method shapes. */
function memoryFs(files: Record<string, string> = {}): OpfsLike & { files: Record<string, string> } {
  const store = { ...files };
  return {
    files: store,
    async readText(path) {
      if (!(path in store)) throw new Error(`ENOENT: ${path}`);
      return store[path];
    },
    async readFile(path) {
      if (!(path in store)) throw new Error(`ENOENT: ${path}`);
      return new TextEncoder().encode(store[path]);
    },
    async writeFile(path, data) {
      store[path] = typeof data === "string" ? data : new TextDecoder().decode(data);
    },
    async writeTextIf(path, text, expected) {
      const current = path in store ? store[path] : null;
      if (current !== expected) return false;
      store[path] = text;
      return true;
    },
    async remove(path) {
      delete store[path];
    },
    async stat(path) {
      if (path in store) return { path, size: (store[path] ?? "").length, modifiedAt: "", kind: "file" as const };
      return null;
    },
    async rename(from, to) {
      store[to] = store[from] ?? "";
      delete store[from];
    },
    async *walk() {
      for (const path of Object.keys(store)) {
        yield { path, size: (store[path] ?? "").length, modifiedAt: "", kind: "file" as const };
      }
    },
  } as OpfsLike & { files: Record<string, string> };
}

test("write then readText and readBytes round-trip through the OPFS writer", async () => {
  const fs = memoryFs();
  const sink = workspaceFileSink(fs);
  await sink.write("logs/a.md", "hello");
  assert.equal(await sink.readText("logs/a.md"), "hello");
  assert.deepEqual(await sink.readBytes("logs/a.md"), new TextEncoder().encode("hello"));
});

test("list returns every file path the writer walks, relative to the root", async () => {
  const sink = workspaceFileSink(memoryFs({ "a.md": "1", "dir/b.md": "2" }));
  assert.deepEqual((await sink.list()).sort(), ["a.md", "dir/b.md"]);
});

test("exists is true only for a file, and remove of a missing file throws", async () => {
  const sink = workspaceFileSink(memoryFs({ "a.md": "1" }));
  assert.equal(await sink.exists("a.md"), true);
  assert.equal(await sink.exists("missing.md"), false);
  await assert.rejects(() => sink.remove("missing.md"), /ENOENT/);
  await sink.remove("a.md");
  assert.equal(await sink.exists("a.md"), false);
});

test("writeIf writes only while the file still reads the expected text", async () => {
  const fs = memoryFs({ "a.md": "old" });
  const sink = workspaceFileSink(fs);
  assert.equal(await sink.writeIf("a.md", "new", "stale"), false);
  assert.equal(fs.files["a.md"], "old");
  assert.equal(await sink.writeIf("a.md", "new", "old"), true);
  assert.equal(fs.files["a.md"], "new");
});

test("rename moves the file", async () => {
  const fs = memoryFs({ "a.md": "1" });
  await workspaceFileSink(fs).rename("a.md", "b.md");
  assert.deepEqual(fs.files, { "b.md": "1" });
});

test("entries gives each file the walk finds with its size, and a missing folder as empty", async () => {
  const fs = memoryFs({ "d/a.md": "abc", "d/e/b.md": "x", "top.md": "1" });
  const walk = fs.walk;
  fs.walk = (dir) => (dir === "gone" ? (async function* () { throw new Error("ENOENT: gone"); })() : walk(dir));
  const sink = workspaceFileSink(fs);
  assert.deepEqual(await sink.entries!(""), [{ path: "d/a.md", size: 3 }, { path: "d/e/b.md", size: 1 }, { path: "top.md", size: 1 }]);
  assert.deepEqual(await sink.entries!("gone"), []);
});
