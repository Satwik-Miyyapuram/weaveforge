import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileStore, guardedSink } from "../application/file-store";
import { conflictCopyPath } from "../domain/conflict-path";
import { MemorySink } from "../infrastructure/memory-sink";

test("guarded write under .weaveforge/ keeps a differing user file and writes a conflict copy", async () => {
  const sink = new MemorySink();
  await sink.write(".weaveforge/x.json", "user");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await guarded.write(".weaveforge/x.json", "mine");
  assert.equal(await sink.readText(".weaveforge/x.json"), "user", "the user's file is not overwritten");
  assert.equal(await sink.readText(conflictCopyPath(".weaveforge/x.json", 1)), "mine");
});

test("a .part temp file under .weaveforge/ is written straight through", async () => {
  const sink = new MemorySink();
  await sink.write(".weaveforge/x.json.part", "old");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await guarded.write(".weaveforge/x.json.part", "new");
  assert.equal(await sink.readText(".weaveforge/x.json.part"), "new");
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
