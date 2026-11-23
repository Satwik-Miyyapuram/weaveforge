import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError } from "@weaveforge/core";
import { createFileStore, guardedSink } from "../application/file-store";
import { conflictCopyPath } from "../domain/conflict-path";
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

test("writeTextIf with expected text writes only while the file still says it", async () => {
  const { fs } = fresh();
  assert.ok(fs.writeTextIf);
  await fs.writeFile("n.md", "v1");
  assert.equal(await fs.writeTextIf("n.md", "v3", "other"), false);
  assert.equal(await fs.writeTextIf("n.md", "v2", "v1"), true);
  assert.equal(await fs.readText("n.md"), "v2");
});

test("writeTextIf with expected null is create-only: an existing file is left alone and the call reports false", async () => {
  const sink = new MemorySink();
  const store = await createFileStore(sink, {});
  const fs = sinkAsWorkspaceFs(guardedSink(sink, store));
  assert.ok(fs.writeTextIf);
  assert.equal(await fs.writeTextIf("n.md", "v1", null), true);
  assert.equal(await fs.writeTextIf("n.md", "v2", null), false, "a file already there is never written over");
  assert.equal(await fs.readText("n.md"), "v1");
  assert.deepEqual(sink.paths(), ["n.md"], "no conflict copy is written for a refused create");
});

test("writeTextIf with expected null: a file that appears after the check is not reported as created", async () => {
  // Another writer creates n.md between this call's existence check and its write.
  class CreatedMidCall extends MemorySink {
    private armed = true;
    override async readText(path: string): Promise<string> {
      if (this.armed && path === "n.md") {
        // The existence check sees nothing; the racer lands right after it.
        this.armed = false;
        await this.write(path, "racer");
        throw new Error("not there yet");
      }
      return super.readText(path);
    }
  }
  const sink = new CreatedMidCall();
  const fs = sinkAsWorkspaceFs(guardedSink(sink, await createFileStore(sink, {})));
  assert.ok(fs.writeTextIf);
  assert.equal(await fs.writeTextIf("n.md", "mine", null), false, "the write did not land at the path, so it is not true");
  assert.equal(await fs.readText("n.md"), "racer");
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

test("an entity save whose text lands in a conflict copy throws ConflictError, so the run lists a conflict", async () => {
  const sink = new MemorySink();
  await sink.write("notes/x.md", "old");
  const fs = sinkAsWorkspaceFs(guardedSink(sink, await createFileStore(sink, {})));
  await assert.rejects(fs.writeTextIf!("notes/x.md", "new", "old"), (err) => err instanceof ConflictError, "the file does not hold the text");
  assert.equal(await sink.readText("notes/x.md"), "old");
  assert.equal(await sink.readText(conflictCopyPath("notes/x.md", 1)), "new");
});

test("an entity save whose file changes again right after the write reports false, not a conflict copy", async () => {
  const sink = new MemorySink();
  await sink.write("notes/x.md", "old");
  const racing = Object.create(sink) as MemorySink;
  racing.write = async (path, data) => {
    await sink.write(path, data);
    await sink.write(path, "user edit");
  };
  const fs = sinkAsWorkspaceFs(racing);
  assert.equal(await fs.writeTextIf!("notes/x.md", "new", "old"), false);
  assert.equal(await sink.readText("notes/x.md"), "user edit");
});