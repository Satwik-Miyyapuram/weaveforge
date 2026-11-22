import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileStore, guardedSink } from "../application/file-store";
import { conflictCopyPath } from "../domain/conflict-path";
import { sha256Hex } from "../domain/hash";
import { MemorySink } from "../infrastructure/memory-sink";

test("guarded write under .weaveforge/ keeps a differing user file and writes a conflict copy", async () => {
  const sink = new MemorySink();
  await sink.write(".weaveforge/x.json", "user");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await guarded.write(".weaveforge/x.json", "mine");
  assert.equal(await sink.readText(".weaveforge/x.json"), "user", "the user's file is not overwritten");
  assert.equal(await sink.readText(conflictCopyPath(".weaveforge/x.json", 1)), "mine");
});

test("a generated temp file (<path>.<8 hex>.part) is written straight through", async () => {
  const sink = new MemorySink();
  await sink.write(".weaveforge/x.json.abcd1234.part", "old");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await guarded.write(".weaveforge/x.json.abcd1234.part", "new");
  assert.equal(await sink.readText(".weaveforge/x.json.abcd1234.part"), "new");
});

test("rename never replaces an existing file", async () => {
  const sink = new MemorySink();
  await sink.write("a.part", "new");
  await sink.write("b.md", "user");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await assert.rejects(guarded.rename("a.part", "b.md"), /refusing to replace/);
  assert.equal(await sink.readText("b.md"), "user", "the existing file is kept");
  assert.equal(await sink.readText("a.part"), "new", "the source is left in place");
});

test("a refused add-keys merge is a conflict: the DB text lands in a copy, the user file is kept", async () => {
  const sink = new MemorySink();
  await sink.write("notes/a.md", "user body");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await assert.rejects(guarded.writeIf("notes/a.md", "other body", "user body"), (err: Error) => err.message.startsWith("conflict:") && err.message.includes("changed on disk, not add-keys-only"));
  assert.equal(await sink.readText("notes/a.md"), "user body", "the user's file is not overwritten");
  assert.equal(await sink.readText(conflictCopyPath("notes/a.md", 1)), "other body");
});
test("a file the user creates mid-run is never overwritten: the DB version goes to a conflict copy", async () => {
  const sink = new MemorySink();
  const store = await createFileStore(sink, {});
  await store.store("a.md", "db a", await sha256Hex(new TextEncoder().encode("db a")));
  await sink.write("b.md", "user bytes");
  const kept = await store.store("b.md", "db b", await sha256Hex(new TextEncoder().encode("db b")));
  assert.equal(kept, conflictCopyPath("b.md", 1));
  assert.equal(await sink.readText("b.md"), "user bytes", "the user's file is intact");
  assert.equal(await sink.readText(kept), "db b");
});
test("a user's own .weaveforge/x.json.part file is guarded like any other file", async () => {
  const sink = new MemorySink();
  await sink.write(".weaveforge/x.json.part", "user");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await guarded.write(".weaveforge/x.json.part", "mine");
  assert.equal(await sink.readText(".weaveforge/x.json.part"), "user", "the user's file is not overwritten");
  assert.equal(await sink.readText(conflictCopyPath(".weaveforge/x.json.part", 1)), "mine");
});
