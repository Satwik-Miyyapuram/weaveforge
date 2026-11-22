import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { loadCore } from "@/lib/rust-core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { workspaceFsAsSink } from "../infrastructure/workspace-fs-sink";

before(async () => {
  await loadCore(readFileSync(new URL("../../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)));
});

test("write then read back text and bytes through the FileSink", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await sink.write("papers/a.md", "hello");
  await sink.write("bin/b.bin", new Uint8Array([1, 2, 3]));
  assert.equal(await sink.readText("papers/a.md"), "hello");
  assert.deepEqual([...(await sink.readBytes("bin/b.bin"))], [1, 2, 3]);
});

test("list returns every file recursively as a relative path", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await sink.write("papers/one.md", "1");
  await sink.write("papers/sub/two.md", "2");
  await sink.write("top.md", "3");
  assert.deepEqual((await sink.list()).sort(), ["papers/one.md", "papers/sub/two.md", "top.md"]);
});

test("rename replaces an existing target", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await sink.write("a.md", "new");
  await sink.write("b.md", "old");
  await sink.rename("a.md", "b.md");
  assert.equal(await sink.readText("b.md"), "new");
  assert.deepEqual(await sink.list(), ["b.md"]);
});

test("remove of a missing file is an error", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await assert.rejects(sink.remove("missing.md"));
});

test("a path that escapes the sink is refused", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await assert.rejects(sink.write("../outside.md", "x"), /escapes/);
});

test("exists is true for a file and false for a missing path or a folder", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await sink.write("papers/a.md", "x");
  assert.equal(await sink.exists("papers/a.md"), true);
  assert.equal(await sink.exists("papers/missing.md"), false);
  assert.equal(await sink.exists("papers"), false);
});

test("writeIf writes only while the file still reads as expected; a missing file is false", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await sink.write("a.md", "one");
  assert.equal(await sink.writeIf("a.md", "two", "stale"), false);
  assert.equal(await sink.readText("a.md"), "one");
  assert.equal(await sink.writeIf("a.md", "two", "one"), true);
  assert.equal(await sink.readText("a.md"), "two");
  assert.equal(await sink.writeIf("missing.md", "x", ""), false);
  assert.equal(await sink.exists("missing.md"), false);
});

test("writeIf refuses, writing nothing, when the workspace has no compare-and-set", async () => {
  const fs = new MemoryWorkspaceFs();
  const plain = Object.assign(Object.create(fs) as MemoryWorkspaceFs, { writeTextIf: undefined });
  const sink = workspaceFsAsSink(plain);
  await sink.write("a.md", "one");
  await assert.rejects(sink.writeIf("a.md", "two", "one"), /compare-and-set/);
  assert.equal(await sink.readText("a.md"), "one");
});

test("exists and writeIf refuse a path that escapes the sink", async () => {
  const sink = workspaceFsAsSink(new MemoryWorkspaceFs());
  await assert.rejects(sink.exists("../x.md"), /escapes/);
  await assert.rejects(sink.writeIf("../x.md", "a", "b"), /escapes/);
});