/**
 * The chunk stores against the port: memory, the workspace folder, and the
 * routed one; and `loadInkPages`, which turns declared order plus what is on
 * disk into the pages the host shows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultInkNoteMeta, inkChunkPath, newInkChunkId } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import { MemoryInkChunkStore, chunkIdOfFileName, loadInkPages } from "../application/ink-chunk-store";
import { FsInkChunkStore } from "../infrastructure/fs-ink-chunk-store";
import { RoutedInkChunkStore } from "../infrastructure/routed-ink-chunk-store";

const NOTE = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

test("chunkIdOfFileName accepts only <ulid>.inkb", () => {
  const id = newInkChunkId();
  assert.equal(chunkIdOfFileName(`${id}.inkb`), id);
  assert.equal(chunkIdOfFileName(`${id}.png`), null);
  assert.equal(chunkIdOfFileName("notes.inkb"), null);
});

test("the memory store round-trips, lists, and removes", async () => {
  const store = new MemoryInkChunkStore();
  const a = newInkChunkId();
  const b = newInkChunkId();
  await store.write(NOTE, a, new Uint8Array([1, 2, 3]));
  await store.write(NOTE, b, new Uint8Array([4]));
  await store.write("other", newInkChunkId(), new Uint8Array([9]));
  assert.deepEqual([...(await store.read(NOTE, a))!], [1, 2, 3]);
  assert.deepEqual((await store.list(NOTE))!.sort(), [a, b].sort());
  await store.remove(NOTE, a);
  assert.equal(await store.read(NOTE, a), null);
  assert.deepEqual(await store.list(NOTE), [b]);
});

test("the folder store writes under .ink/<note>/ and lists only chunks", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new FsInkChunkStore(() => fs);
  const id = newInkChunkId();
  await store.write(NOTE, id, new Uint8Array([7, 7]));
  assert.notEqual(await fs.stat(inkChunkPath(NOTE, id)), null);
  await fs.writeFile(`.ink/${NOTE}/thumb.png`, new Uint8Array([0]));
  assert.deepEqual(await store.list(NOTE), [id]);
  assert.deepEqual([...(await store.read(NOTE, id))!], [7, 7]);
  assert.equal(await store.read(NOTE, newInkChunkId()), null);
  await store.remove(NOTE, id);
  assert.equal(await store.read(NOTE, id), null);
  assert.equal(await new FsInkChunkStore(() => null).read(NOTE, id), null);
});

test("the routed store delegates each call to whichever store is picked now", async () => {
  const first = new MemoryInkChunkStore();
  const second = new MemoryInkChunkStore();
  let current = first;
  const routed = new RoutedInkChunkStore(() => current);
  const id = newInkChunkId();
  await routed.write(NOTE, id, new Uint8Array([1]));
  current = second;
  assert.equal(await routed.read(NOTE, id), null);
  assert.equal(first.size, 1);
});

test("loadInkPages keeps declared order, appends orphans, and makes one page from nothing", async () => {
  const store = new MemoryInkChunkStore();
  const empty = await loadInkPages(store, NOTE, defaultInkNoteMeta());
  assert.equal(empty.length, 1);
  assert.equal(empty[0]!.chunk, null);

  const a = newInkChunkId();
  const b = newInkChunkId();
  const orphan = newInkChunkId();
  await store.write(NOTE, a, new Uint8Array([1]));
  await store.write(NOTE, orphan, new Uint8Array([3]));
  const pages = await loadInkPages(store, NOTE, {
    ...defaultInkNoteMeta(),
    paper: "ruled",
    pageOrder: [b, a],
  });
  assert.deepEqual(
    pages.map((page) => page.chunkId),
    [b, a, orphan],
  );
  assert.equal(pages[0]!.chunk, null, "a declared page whose chunk is missing stays, empty");
  assert.deepEqual([...pages[1]!.chunk!], [1]);
  assert.equal(pages[2]!.paper, "ruled");
});
