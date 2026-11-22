import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { sinkAsWorkspaceFs } from "../infrastructure/sink-workspace-fs";

function fresh() {
  const sink = new MemorySink();
  return { sink, fs: sinkAsWorkspaceFs(sink) };
}

test("text and bytes round-trip through the sink, leading slash ignored", async () => {
  const { fs, sink } = fresh();
  await fs.writeFile("/.weaveforge/a.md", "hello");
  await fs.writeFile("b.bin", new Uint8Array([1, 2, 3]));
  assert.equal(await fs.readText(".weaveforge/a.md"), "hello");
  assert.deepEqual([...(await fs.readFile("b.bin"))], [1, 2, 3]);
  assert.equal(await sink.readText(".weaveforge/a.md"), "hello");
});

test("list returns immediate children only, dirs derived from paths", async () => {
  const { fs } = fresh();
  await fs.writeFile("papers/one.md", "1");
  await fs.writeFile("papers/sub/two.md", "2");
  await fs.writeFile("top.md", "3");
  const names = (await fs.list("papers")).map((s) => `${s.kind}:${s.path}`).sort();
  assert.deepEqual(names, ["dir:papers/sub", "file:papers/one.md"]);
});

test("walk yields files only, recursively", async () => {
  const { fs } = fresh();
  await fs.writeFile("papers/one.md", "1");
  await fs.writeFile("papers/sub/two.md", "2");
  await fs.writeFile("other.md", "3");
  const seen: string[] = [];
  for await (const stat of fs.walk("papers")) seen.push(stat.path);
  assert.deepEqual(seen.sort(), ["papers/one.md", "papers/sub/two.md"]);
});

test("writeTextIf writes only while the file still says expected", async () => {
  const { fs } = fresh();
  assert.ok(fs.writeTextIf);
  assert.equal(await fs.writeTextIf("n.md", "v1", null), true);
  assert.equal(await fs.writeTextIf("n.md", "v2", null), false);
  assert.equal(await fs.writeTextIf("n.md", "v2", "v1"), true);
  assert.equal(await fs.readText("n.md"), "v2");
});

test("stat, rename and remove", async () => {
  const { fs } = fresh();
  await fs.writeFile("x/a.md", "abc");
  assert.equal((await fs.stat("x/a.md"))?.size, 3);
  assert.equal((await fs.stat("x/missing.md")) ?? null, null);
  await fs.rename("x/a.md", "x/b.md");
  assert.equal(await fs.stat("x/a.md"), null);
  assert.equal(await fs.readText("x/b.md"), "abc");
  await fs.remove("x/b.md");
  assert.equal(await fs.stat("x/b.md"), null);
});
