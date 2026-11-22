import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileStore, guardedSink } from "../application/file-store";
import type { FileSink } from "../domain/ports";
import { conflictCopyPath } from "../domain/conflict-path";
import { sha256Hex } from "../domain/hash";

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * A case-insensitive sink, like Windows or macOS default folders: "notes/x.md" and "Notes/X.md" are one file.
 * Its listing shows the stored spelling only, so a presence check that trusts list() misses the user's file.
 */
class FoldSink implements FileSink {
  readonly files = new Map<string, Uint8Array>();
  /** Paths whose stat fails (exists throws) while the file is still there. */
  readonly statFails = new Set<string>();

  private storedKey(path: string): string {
    const lower = path.toLowerCase();
    return [...this.files.keys()].find((k) => k.toLowerCase() === lower) ?? path;
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    this.files.set(this.storedKey(path), typeof data === "string" ? enc.encode(data) : data.slice());
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async exists(path: string): Promise<boolean> {
    if (this.statFails.has(path)) throw new Error(`EIO: stat ${path}`);
    return this.files.has(this.storedKey(path));
  }

  async readText(path: string): Promise<string> {
    return dec.decode(await this.readBytes(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(this.storedKey(path));
    if (!bytes) throw new Error(`missing file: ${path}`);
    return bytes;
  }

  async rename(from: string, to: string): Promise<void> {
    const bytes = await this.readBytes(from);
    this.files.delete(this.storedKey(from));
    this.files.set(to, bytes);
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(this.storedKey(path))) throw new Error(`missing file: ${path}`);
  }

  async writeIf(path: string, text: string, expected: string): Promise<boolean> {
    const current = this.files.get(this.storedKey(path));
    if (!current || dec.decode(current) !== expected) return false;
    await this.write(path, text);
    return true;
  }
}

test("presence is checked with stat: a case-only mismatch never overwrites the user's file", async () => {
  const sink = new FoldSink();
  await sink.write("Notes/X.md", "user");
  const store = await createFileStore(sink, {});
  const held = await store.store("notes/x.md", "mine", await sha256Hex("mine"));
  assert.equal(await sink.readText("Notes/X.md"), "user", "the user's file keeps its bytes");
  assert.equal(held, conflictCopyPath("notes/x.md", 1), "the DB version lands in a conflict copy");
  assert.deepEqual(store.conflicts, [held]);
});

test("rename refuses a case-only collision with the user's file and keeps its bytes", async () => {
  const sink = new FoldSink();
  await sink.write("Notes/X.md", "user");
  await sink.write("a.part", "mine");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await assert.rejects(guarded.rename("a.part", "notes/x.md"), /refusing to replace/);
  assert.equal(await sink.readText("Notes/X.md"), "user", "the user's file keeps its bytes");
  assert.equal(await sink.readText("a.part"), "mine", "the source is not moved");
});

test("rename to a free name moves the file", async () => {
  const sink = new FoldSink();
  await sink.write("a.part", "mine");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await guarded.rename("a.part", "b.md");
  assert.equal(await sink.readText("b.md"), "mine");
  assert.equal(await sink.exists("a.part"), false);
});

test("rename treats a target whose stat fails as present and refuses", async () => {
  const sink = new FoldSink();
  await sink.write("a.part", "mine");
  sink.statFails.add("b.md");
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  await assert.rejects(guarded.rename("a.part", "b.md"), /refusing to replace/);
  assert.equal(await sink.readText("a.part"), "mine", "the source is not moved");
});

test("a file whose stat fails counts as present and is never overwritten", async () => {
  const sink = new FoldSink();
  await sink.write("a.md", "user");
  sink.statFails.add("a.md");
  const store = await createFileStore(sink, {});
  const held = await store.store("a.md", "mine", await sha256Hex("mine"));
  assert.equal(await sink.readText("a.md"), "user", "the unreadable file is kept");
  assert.equal(held, conflictCopyPath("a.md", 1));
  assert.equal(await sink.readText(held), "mine");
});
