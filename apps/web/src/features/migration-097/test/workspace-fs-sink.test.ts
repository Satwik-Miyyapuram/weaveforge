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