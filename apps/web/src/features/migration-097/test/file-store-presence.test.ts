import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileStore } from "../application/file-store";
import { sha256Hex } from "../domain/hash";
import { MemorySink } from "../infrastructure/memory-sink";

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
