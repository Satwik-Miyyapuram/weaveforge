/**
 * The chunk stores against the port: memory, the workspace folder, and the
 * routed one; and `loadInkPages`, which turns declared order plus what is on
 * disk into the pages the host shows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BlobNotFoundError,
  defaultInkNoteMeta,
  inkChunkPath,
  newInkChunkId,
  type IBlobFetcher,
} from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import {
  MemoryInkChunkStore,
  chunkIdOfFileName,
  loadInkPages,
} from "../application/ink-chunk-store";
import { BlobInkChunkStore } from "../infrastructure/blob-ink-chunk-store";
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
  assert.equal(
    pages[0]!.chunk,
    null,
    "a declared page whose chunk is missing stays, empty",
  );
  assert.deepEqual([...pages[1]!.chunk!], [1]);
  assert.equal(pages[2]!.paper, "ruled");
});

test("strokes from two sides are kept together, and settling one never clears the other", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new FsInkChunkStore(() => fs);
  // Two sides' pages for one note. Ids are minted per page, so the two sets
  // cannot collide and neither write replaces the other.
  const ours = newInkChunkId();
  const theirs = newInkChunkId();
  await store.write(NOTE, ours, new Uint8Array([1]));
  await store.write(NOTE, theirs, new Uint8Array([2]));

  assert.deepEqual(await store.list(NOTE), [ours, theirs].sort());

  // Removing one page removes that page. The other side's handwriting is not
  // collateral -- which is the property "take this app's copy" depends on when
  // it settles the *text* of a note whose strokes both sides added to.
  await store.remove(NOTE, ours);
  assert.deepEqual(await store.list(NOTE), [theirs]);
  assert.deepEqual([...(await store.read(NOTE, theirs))!], [2]);
});

/** A memory store whose reads of the listed chunks fail, as a broken disk or decrypt would. */
class FailingReads extends MemoryInkChunkStore {
  constructor(private readonly failing: Set<string>) {
    super();
  }
  override async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    if (this.failing.has(chunkId)) throw new Error("EIO: read failed");
    return super.read(noteId, chunkId);
  }
}

test("a chunk that fails to read is marked unreadable, not missing (18-01)", async () => {
  const good = newInkChunkId();
  const broken = newInkChunkId();
  const gone = newInkChunkId();
  const store = new FailingReads(new Set([broken]));
  await store.write(NOTE, good, new Uint8Array([1]));
  await store.write(NOTE, broken, new Uint8Array([2]));
  const meta = { ...defaultInkNoteMeta(), pageOrder: [good, broken, gone] };
  const pages = await loadInkPages(store, NOTE, meta);
  assert.deepEqual(pages.map((p) => p.chunkId), [good, broken, gone]);
  assert.deepEqual([...pages[0]!.chunk!], [1]);
  assert.ok(!pages[0]!.unreadable);
  assert.equal(pages[1]!.chunk, null);
  assert.equal(pages[1]!.unreadable, true);
  // A chunk that is simply not there is an empty page, as before.
  assert.equal(pages[2]!.chunk, null);
  assert.ok(!pages[2]!.unreadable);
});

test("a note saved before this change loads, saves and reloads the same", async () => {
  const store = new MemoryInkChunkStore();
  const a = newInkChunkId();
  await store.write(NOTE, a, new Uint8Array([5, 6]));
  const meta = { ...defaultInkNoteMeta(), pageOrder: [a] };
  const [page] = await loadInkPages(store, NOTE, meta);
  assert.deepEqual([...page!.chunk!], [5, 6]);
  assert.ok(!page!.unreadable);
  await store.write(NOTE, a, new Uint8Array([7]));
  const [again] = await loadInkPages(store, NOTE, meta);
  assert.deepEqual([...again!.chunk!], [7]);
});

/** A blob fetcher whose reads answer with `fail`, and a session with one user. */
function blobStore(fail: unknown) {
  const blobs = {
    upload: async () => {},
    remove: async () => {},
    signedUrls: async () => [],
    fetchBytes: async () => {
      throw fail;
    },
    fetchBlob: async () => new Blob(),
    fetchBlobs: async () => new Map(),
  } as IBlobFetcher;
  const session = { requireUserId: async () => "u1" } as never;
  return new BlobInkChunkStore(blobs, session);
}

test("the blob store reads a missing chunk as null, and fails on anything else (19-07)", async () => {
  const id = newInkChunkId();
  assert.equal(await blobStore(new BlobNotFoundError("vault-assets", "x")).read(NOTE, id), null);
  await assert.rejects(blobStore(new TypeError("Failed to fetch")).read(NOTE, id), /Failed to fetch/);
});
