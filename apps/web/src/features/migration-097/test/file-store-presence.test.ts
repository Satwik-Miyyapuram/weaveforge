import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileStore } from "../application/file-store";
import { sha256Hex } from "../domain/hash";
import { MemorySink } from "../infrastructure/memory-sink";
import { conflictCopyPath } from "../domain/conflict-path";

/** A sink whose reads of one path fail, as an unreadable file does. The file still lists. */
class UnreadableSink extends MemorySink {
  reads = 0;
  constructor(private readonly locked: string) {
    super();
  }
  override async readBytes(path: string): Promise<Uint8Array> {
    if (path === this.locked) {
      this.reads++;
      throw new Error(`permission denied: ${path}`);
    }
    return super.readBytes(path);
  }
  /** The stored bytes, bypassing the lock, for the assertions. */
  async raw(path: string): Promise<string> {
    return new TextDecoder().decode(await super.readBytes(path));
  }
}

test("an existing unreadable file is never overwritten: the DB version goes to a conflict copy", async () => {
  const sink = new UnreadableSink("a.json");
  await sink.write("a.json", "user bytes");
  const store = await createFileStore(sink, {});

  const held = await store.store("a.json", "db version", await sha256Hex("db version"));

  assert.notEqual(held, "a.json");
  assert.equal(await sink.raw("a.json"), "user bytes");
});

test("an existing readable file is read once per candidate, and the hash comes from that one read", async () => {
  const sink = new UnreadableSink("none");
  await sink.write("b.json", "user bytes");
  const reads: string[] = [];
  const counting = Object.assign(Object.create(sink), {
    list: () => sink.list(),
    write: (p: string, d: string | Uint8Array) => sink.write(p, d),
    readBytes: async (p: string) => {
      reads.push(p);
      return sink.readBytes(p);
    },
  });
  const store = await createFileStore(counting, {});

  await store.store("b.json", "db version", await sha256Hex("db version"));

  assert.equal(reads.filter((p) => p === "b.json").length, 1);
});

test("a conflict copy whose .sha256 sidecar is already taken is skipped: no blob lands without its sidecar", async () => {
  const sink = new MemorySink();
  await sink.write("c.bin", "user bytes");
  const copy1 = conflictCopyPath("c.bin", 1);
  // A stale sidecar sits at the first copy's name, while the blob name itself is free.
  await sink.write(`${copy1}.sha256`, "stale");
  const store = await createFileStore(sink, {});

  const held = await store.store("c.bin", "db version", await sha256Hex("db version"));

  assert.notEqual(held, copy1);
  assert.equal(await sink.exists(copy1), false);
  assert.equal(await sink.exists(conflictCopyPath("c.bin", 2)), true);
});

/**
 * Every exists() call throws, so no candidate ever reads as free. The kill switch ends a run that does not stop
 * on its own (after 5000 calls the sink answers honestly), so a red test fails instead of hanging.
 */
class AlwaysThrowingExistsSink extends MemorySink {
  calls = 0;
  override async exists(path: string): Promise<boolean> {
    this.calls++;
    if (this.calls > 5000) return super.exists(path);
    throw new Error("EIO: exists");
  }
}

test("store: a sink whose exists always throws ends with a coded error, not an endless candidate loop", async () => {
  const sink = new AlwaysThrowingExistsSink();
  const store = await createFileStore(sink, {});

  const err = await store.store("d.json", "db version", await sha256Hex("db version")).then(
    () => null,
    (e: Error & { code?: string }) => e,
  );

  assert.equal(err?.code, "file-store-candidates-exhausted");
  assert.ok(sink.calls < 5000, "the candidate loop stopped before the kill switch");
});

test("store: a stale .sha256 at the path itself keeps the blob off that name: no blob lands without its own sidecar", async () => {
  const sink = new MemorySink();
  await sink.write("e.bin.sha256", "stale");
  const store = await createFileStore(sink, {});

  const held = await store.store("e.bin", "db version", await sha256Hex("db version"));

  assert.notEqual(held, "e.bin");
  assert.equal(await sink.exists("e.bin"), false);
});

test("store: a missing blob whose sidecar already holds its own sha256 lands at the path itself", async () => {
  const sink = new MemorySink();
  const hash = await sha256Hex("db version");
  await sink.write("f.bin.sha256", `${hash}\n`);
  const store = await createFileStore(sink, {});

  const held = await store.store("f.bin", "db version", hash);

  assert.equal(held, "f.bin");
  assert.equal(await sink.readText("f.bin"), "db version");
  assert.equal(await sha256Hex(await sink.readBytes("f.bin")), (await sink.readText("f.bin.sha256")).split("\n")[0]);
});

/** A sink where the user saves `path` right after the store reads it, before the store writes. */
class EditAfterReadSink extends MemorySink {
  constructor(
    private readonly path: string,
    private readonly edit: string | Uint8Array,
  ) {
    super();
  }
  armed = false;
  override async readBytes(path: string): Promise<Uint8Array> {
    const bytes = await super.readBytes(path);
    if (this.armed && path === this.path) {
      this.armed = false;
      await super.write(path, this.edit);
    }
    return bytes;
  }
}

test("store: a text edit between the hash read and the write is kept; the DB version goes to a conflict copy", async () => {
  const sink = new EditAfterReadSink("g.md", "user edit");
  await sink.write("g.md", "ours");
  const store = await createFileStore(sink, { "g.md": await sha256Hex("ours") });
  sink.armed = true;

  const held = await store.store("g.md", "db version", await sha256Hex("db version"));

  assert.equal(await sink.readText("g.md"), "user edit");
  assert.equal(held, conflictCopyPath("g.md", 1));
  assert.equal(await sink.readText(held), "db version");
});

test("store: a binary edit between the hash read and the write is kept; the DB version goes to a conflict copy", async () => {
  const sink = new EditAfterReadSink("h.bin", new Uint8Array([9, 9]));
  await sink.write("h.bin", new Uint8Array([1, 2]));
  const store = await createFileStore(sink, { "h.bin": await sha256Hex(new Uint8Array([1, 2])) });
  sink.armed = true;
  const db = new Uint8Array([3, 4]);

  const held = await store.store("h.bin", db, await sha256Hex(db));

  assert.deepEqual([...(await sink.readBytes("h.bin"))], [9, 9]);
  assert.notEqual(held, "h.bin");
  assert.deepEqual([...(await sink.readBytes(held))], [3, 4]);
});