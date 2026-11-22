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
    async mkdirp() {},
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

test("one adapter: workspaceFileSink creates parent folders and refuses an escaping path", async () => {
  const fs = memoryFs();
  const made: string[] = [];
  const sink = workspaceFileSink({ ...fs, mkdirp: async (dir: string) => void made.push(dir) });
  await sink.write("logs/day/a.md", "hello");
  assert.deepEqual(made, ["logs/day"]);
  await assert.rejects(sink.write("../outside.md", "x"), /escapes/);
});

test("list leaves out folder entries the walk yields", async () => {
  const fs = memoryFs({ "dir/b.md": "2" });
  const sink = workspaceFileSink({
    ...fs,
    async *walk() {
      yield { path: "dir", size: 0, modifiedAt: "", kind: "dir" as const };
      yield { path: "dir/b.md", size: 1, modifiedAt: "", kind: "file" as const };
    },
  });
  assert.deepEqual(await sink.list(), ["dir/b.md"]);
});

test("rename moves the file", async () => {
  const fs = memoryFs({ "a.md": "1" });
  await workspaceFileSink(fs).rename("a.md", "b.md");
  assert.deepEqual(fs.files, { "b.md": "1" });
});
