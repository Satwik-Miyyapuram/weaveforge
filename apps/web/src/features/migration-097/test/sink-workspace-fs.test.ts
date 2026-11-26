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

test("an entity save whose file changes again right after the write throws ConflictError, so the repo saves no copy note", async () => {
  const sink = new MemorySink();
  await sink.write("notes/x.md", "old");
  const racing = Object.create(sink) as MemorySink;
  racing.write = async (path, data) => {
    await sink.write(path, data);
    await sink.write(path, "user edit");
  };
  const fs = sinkAsWorkspaceFs(racing);
  await assert.rejects(fs.writeTextIf!("notes/x.md", "new", "old"), (err) => err instanceof ConflictError);
  assert.equal(await sink.readText("notes/x.md"), "user edit");
  assert.deepEqual((await sink.list()).filter((p) => p.startsWith("notes/")), ["notes/x.md"]);
});
/** A MemorySink with a sized listing, counting the calls that scan or read every file. */
class ListingSink extends MemorySink {
  calls = { list: 0, readBytes: 0, entries: [] as string[] };
  override async list(): Promise<string[]> {
    this.calls.list++;
    return super.list();
  }
  override async readBytes(path: string): Promise<Uint8Array> {
    this.calls.readBytes++;
    return super.readBytes(path);
  }
  async entries(dir: string): Promise<{ path: string; size: number }[]> {
    this.calls.entries.push(dir);
    const prefix = dir === "" ? "" : `${dir}/`;
    const out: { path: string; size: number }[] = [];
    for (const path of await super.list()) {
      if (path.startsWith(prefix)) out.push({ path, size: (await super.readBytes(path)).byteLength });
    }
    return out;
  }
}

test("with a sized listing, list/walk/stat read no file bodies and scan only the asked folder", async () => {
  const sink = new ListingSink();
  const fs = sinkAsWorkspaceFs(sink);
  await fs.writeFile("papers/one.md", "abc");
  await fs.writeFile("papers/sub/two.md", "de");
  await fs.writeFile("notes/n.md", "x");
  sink.calls = { list: 0, readBytes: 0, entries: [] };

  const listed = (await fs.list("papers")).map((s) => `${s.kind}:${s.path}:${s.size}`).sort();
  assert.deepEqual(listed, ["dir:papers/sub:0", "file:papers/one.md:3"]);
  const walked: string[] = [];
  for await (const e of fs.walk("/papers/")) walked.push(`${e.path}:${e.size}`);
  assert.deepEqual(walked.sort(), ["papers/one.md:3", "papers/sub/two.md:2"]);
  assert.equal((await fs.stat("papers"))?.kind, "dir");
  assert.equal(await fs.stat("nothing"), null);
  assert.equal((await fs.stat("notes/n.md"))?.kind, "file");

  assert.equal(sink.calls.list, 0);
  assert.deepEqual(sink.calls.entries, ["papers", "papers", "papers", "nothing"]);
  assert.equal(sink.calls.readBytes, 1, "only the one file stat reads its own body");
});

test("remove of a file checks that file only, never the whole sink", async () => {
  const sink = new ListingSink();
  const fs = sinkAsWorkspaceFs(sink);
  await fs.writeFile("a.md", "1");
  await fs.writeFile("dir/b.md", "2");
  sink.calls = { list: 0, readBytes: 0, entries: [] };
  await fs.remove("a.md");
  assert.equal(await sink.exists("a.md"), false);
  assert.equal(sink.calls.list + sink.calls.entries.length + sink.calls.readBytes, 0);
  await fs.remove("dir", { recursive: true });
  assert.equal(await sink.exists("dir/b.md"), false);
});

test("guardedSink forwards the sized listing, and leaves it out when the sink has none", async () => {
  const sized = new ListingSink();
  await sized.write("a/b.md", "xy");
  const guarded = guardedSink(sized, await createFileStore(sized, {}));
  assert.deepEqual(await guarded.entries?.("a"), [{ path: "a/b.md", size: 2 }]);
  assert.equal(guardedSink(new MemorySink(), await createFileStore(new MemorySink(), {})).entries, undefined);
});
test("cacheReads: a file is read from the sink once until this fs writes it or a compare-and-set misses", async () => {
  const sink = new MemorySink();
  await sink.write("p.md", "one");
  let reads = 0;
  const readText = sink.readText.bind(sink);
  sink.readText = async (path) => (reads++, readText(path));
  const fs = sinkAsWorkspaceFs(sink, { compareAndSet: true, cacheReads: true });
  assert.equal(await fs.readText("p.md"), "one");
  assert.equal(await fs.readText("p.md"), "one");
  assert.equal(reads, 1);
  await fs.writeFile("p.md", "two");
  assert.equal(await fs.readText("p.md"), "two");
  await sink.write("p.md", "outside");
  assert.equal(await fs.writeTextIf!("p.md", "three", "two"), false);
  assert.equal(await fs.readText("p.md"), "outside");
  await fs.rename("p.md", "q.md");
  await assert.rejects(fs.readText("p.md"));
});