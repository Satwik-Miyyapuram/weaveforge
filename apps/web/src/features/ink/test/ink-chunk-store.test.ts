/**
 * The chunk stores against the port: memory, the workspace folder, and the
 * routed one; and `loadInkPages`, which turns declared order plus what is on
 * disk into the pages the host shows.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { BlobNotFoundError, type IBlobFetcher } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";

import {
  InkNoFolderError,
  MemoryInkChunkStore,
  loadInkPages,
} from "../application/parts-1";
import {
  BlobInkChunkStore,
  CopyOnReadInkChunkStore,
  FolderInkNotes,
  FsInkChunkStore,
  UnavailableInkChunkStore,
} from "../infrastructure/parts";
import { RoutedInkChunkStore, inkChunkStoreFor } from "../../../container/parts";
import { readyCore, typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

const NOTE ="01HZZZZZZZZZZZZZZZZZZZZZZZ";
/** The note's file: its strokes sit beside it in `p/notes/sketch.ink/`. */
const NOTE_PATH = "p/notes/sketch.ink.md";

/** A folder holding the note's markdown, as the mirror writes it. */
async function inkNoteFolder(): Promise<MemoryWorkspaceFs> {
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp("p/notes");
  await fs.writeFile(NOTE_PATH, `---\nweaveforge-id: ${NOTE}\nweaveforge-type: ink_page\n---\n`);
  return fs;
}

function folderStore(fs: MemoryWorkspaceFs): FsInkChunkStore {
  return new FsInkChunkStore(() => fs, new FolderInkNotes(() => fs));
}

test("chunkIdOfFileName accepts only <ulid>.inkb", () => {
  const id = typedCore().newInkChunkId();
  assert.equal(readyCore().inkChunkIdOfFileName(`${id}.inkb`), id);
  assert.equal(readyCore().inkChunkIdOfFileName(`${id}.png`), null);
  assert.equal(readyCore().inkChunkIdOfFileName("notes.inkb"), null);
});

test("the memory store round-trips, lists, and removes", async () => {
  const store = new MemoryInkChunkStore();
  const a = typedCore().newInkChunkId();
  const b = typedCore().newInkChunkId();
  await store.write(NOTE, a, new Uint8Array([1, 2, 3]));
  await store.write(NOTE, b, new Uint8Array([4]));
  await store.write("other", typedCore().newInkChunkId(), new Uint8Array([9]));
  assert.deepEqual([...(await store.read(NOTE, a))!], [1, 2, 3]);
  assert.deepEqual((await store.list(NOTE))!.sort(), [a, b].sort());
  await store.remove(NOTE, a);
  assert.equal(await store.read(NOTE, a), null);
  assert.deepEqual(await store.list(NOTE), [b]);
});

test("the folder store writes beside the note file, in <name>.ink/, and lists only chunks", async () => {
  const fs = await inkNoteFolder();
  const store = folderStore(fs);
  const id = typedCore().newInkChunkId();
  await store.write(NOTE, id, new Uint8Array([7, 7]));
  assert.notEqual(await fs.stat(typedCore().inkChunkPath(NOTE_PATH, id)), null);
  await fs.writeFile("p/notes/sketch.ink/thumb.png", new Uint8Array([0]));
  assert.deepEqual(await store.list(NOTE), [id]);
  assert.deepEqual([...(await store.read(NOTE, id))!], [7, 7]);
  assert.equal(await store.read(NOTE, typedCore().newInkChunkId()), null);
  await store.remove(NOTE, id);
  assert.equal(await store.read(NOTE, id), null);
  assert.equal(await new FsInkChunkStore(() => null, new FolderInkNotes(() => null)).read(NOTE, id), null);
});

test("the routed store delegates each call to whichever store is picked now", async () => {
  const first = new MemoryInkChunkStore();
  const second = new MemoryInkChunkStore();
  let current = first;
  const routed = new RoutedInkChunkStore(() => current);
  const id = typedCore().newInkChunkId();
  await routed.write(NOTE, id, new Uint8Array([1]));
  current = second;
  assert.equal(await routed.read(NOTE, id), null);
  assert.equal(first.size, 1);
});

test("loadInkPages keeps declared order, appends orphans, and makes one page from nothing", async () => {
  const store = new MemoryInkChunkStore();
  const empty = await loadInkPages(store, NOTE, typedCore().defaultInkNoteMeta());
  assert.equal(empty.length, 1);
  assert.equal(empty[0]!.chunk, null);

  const a = typedCore().newInkChunkId();
  const b = typedCore().newInkChunkId();
  const orphan = typedCore().newInkChunkId();
  await store.write(NOTE, a, new Uint8Array([1]));
  await store.write(NOTE, orphan, new Uint8Array([3]));
  const pages = await loadInkPages(store, NOTE, {
    ...typedCore().defaultInkNoteMeta(),
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
  const fs = await inkNoteFolder();
  const store = folderStore(fs);
  // Two sides' pages for one note. Ids are minted per page, so the two sets
  // cannot collide and neither write replaces the other.
  const ours = typedCore().newInkChunkId();
  const theirs = typedCore().newInkChunkId();
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
  const good = typedCore().newInkChunkId();
  const broken = typedCore().newInkChunkId();
  const gone = typedCore().newInkChunkId();
  const store = new FailingReads(new Set([broken]));
  await store.write(NOTE, good, new Uint8Array([1]));
  await store.write(NOTE, broken, new Uint8Array([2]));
  const meta = { ...typedCore().defaultInkNoteMeta(), pageOrder: [good, broken, gone] };
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
  const a = typedCore().newInkChunkId();
  await store.write(NOTE, a, new Uint8Array([5, 6]));
  const meta = { ...typedCore().defaultInkNoteMeta(), pageOrder: [a] };
  const [page] = await loadInkPages(store, NOTE, meta);
  assert.deepEqual([...page!.chunk!], [5, 6]);
  assert.ok(!page!.unreadable);
  await store.write(NOTE, a, new Uint8Array([7]));
  const [again] = await loadInkPages(store, NOTE, meta);
  assert.deepEqual([...again!.chunk!], [7]);
});

test("on the desktop with no folder open, ink goes nowhere: never the bucket", async () => {
  const folder = new MemoryInkChunkStore();
  const bucket = new MemoryInkChunkStore();
  const unavailable = new UnavailableInkChunkStore();
  const stores = { folder, bucket, unavailable };
  assert.equal(inkChunkStoreFor({ folderOpen: true, desktop: true }, stores), folder);
  assert.equal(inkChunkStoreFor({ folderOpen: false, desktop: true }, stores), unavailable);
  assert.equal(inkChunkStoreFor({ folderOpen: false, desktop: false }, stores), bucket);

  const id = typedCore().newInkChunkId();
  await assert.rejects(unavailable.write(NOTE, id, new Uint8Array([1])), /open a workspace folder/);
  await assert.rejects(unavailable.read(NOTE, id), /open a workspace folder/);
  await assert.rejects(unavailable.list(NOTE), /open a workspace folder/);
  assert.equal(bucket.size, 0);
});

test("on the desktop with no folder, the host load fails with InkNoFolderError, not a generic error", async () => {
  const unavailable = new UnavailableInkChunkStore();
  const meta = typedCore().defaultInkNoteMeta();
  await assert.rejects(loadInkPages(unavailable, NOTE, meta), (err: unknown) => {
    assert.ok(err instanceof InkNoFolderError);
    assert.match((err as Error).message, /open a workspace folder/);
    return true;
  });
});

test("a folder page missing on disk is copied from the bucket on first read; the bucket keeps its copy", async () => {
  const folder = new MemoryInkChunkStore();
  const bucket = new MemoryInkChunkStore();
  const id = typedCore().newInkChunkId();
  await bucket.write(NOTE, id, new Uint8Array([8, 9]));
  const store = new CopyOnReadInkChunkStore(folder, bucket);
  assert.deepEqual([...(await store.read(NOTE, id))!], [8, 9]);
  assert.deepEqual([...(await folder.read(NOTE, id))!], [8, 9]);
  assert.deepEqual([...(await bucket.read(NOTE, id))!], [8, 9]);
  assert.deepEqual(await store.list(NOTE), [id]);
});

test("the bucket is read at most once per page: a copied page is read from the folder after that", async () => {
  class CountingBucket extends MemoryInkChunkStore {
    reads = 0;
    override async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
      this.reads += 1;
      return super.read(noteId, chunkId);
    }
  }
  const folder = new MemoryInkChunkStore();
  const bucket = new CountingBucket();
  const id = typedCore().newInkChunkId();
  await bucket.write(NOTE, id, new Uint8Array([1]));
  const store = new CopyOnReadInkChunkStore(folder, bucket);
  await store.read(NOTE, id);
  await store.read(NOTE, id);
  assert.equal(bucket.reads, 1);
});

test("copy-on-read: a page in neither home is empty, and a failed bucket read throws rather than reading empty", async () => {
  const folder = new MemoryInkChunkStore();
  const absent = typedCore().newInkChunkId();
  const broken = typedCore().newInkChunkId();
  const bucket = new FailingReads(new Set([broken]));
  const store = new CopyOnReadInkChunkStore(folder, bucket);
  assert.equal(await store.read(NOTE, absent), null);
  await assert.rejects(store.read(NOTE, broken), /EIO/);
  assert.equal(folder.size, 0);
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
  const id = typedCore().newInkChunkId();
  assert.equal(await blobStore(new BlobNotFoundError("vault-assets", "x")).read(NOTE, id), null);
  await assert.rejects(blobStore(new TypeError("Failed to fetch")).read(NOTE, id), /Failed to fetch/);
});

// --- per-note migration marker (0.9.2 review) ---

/** A memory bucket that counts its reads, so a test can say it was never asked. */
class CountedBucket extends MemoryInkChunkStore {
  reads = 0;
  override async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    this.reads += 1;
    return super.read(noteId, chunkId);
  }
}

/** The real blob store, signed out: every read throws before it reaches the network. */
function signedOutBucket(): { store: BlobInkChunkStore; reads: () => number } {
  let reads = 0;
  const blobs = {
    upload: async () => {},
    remove: async () => {},
    signedUrls: async () => [],
    fetchBytes: async () => {
      throw new TypeError("Failed to fetch");
    },
    fetchBlob: async () => new Blob(),
    fetchBlobs: async () => new Map(),
  } as IBlobFetcher;
  const session = {
    requireUserId: async () => {
      reads += 1;
      throw new Error("not signed in");
    },
  } as never;
  return { store: new BlobInkChunkStore(blobs, session), reads: () => reads };
}

function metaWith(pageOrder: string[]) {
  return { ...typedCore().defaultInkNoteMeta(), pageOrder };
}

test("migration: a copied note is marked, and an erased page stays erased without asking the bucket", async () => {
  const fs = await inkNoteFolder();
  const folder = folderStore(fs);
  const bucket = new CountedBucket();
  const id = typedCore().newInkChunkId();
  await bucket.write(NOTE, id, new Uint8Array([8, 9]));
  const store = new CopyOnReadInkChunkStore(folder, bucket);

  const [page] = await loadInkPages(store, NOTE, metaWith([id]));
  assert.deepEqual([...page!.chunk!], [8, 9]);
  assert.deepEqual([...(await fs.readFile(typedCore().inkChunkPath(NOTE_PATH, id)))], [8, 9]);
  assert.equal(await folder.isMigrated(NOTE), true, "every declared page copied and read back: marked");
  assert.deepEqual(await folder.list(NOTE), [id], "the marker is not a page");

  // The last stroke goes: the host removes the chunk, the page stays declared.
  await store.remove(NOTE, id);
  bucket.reads = 0;
  const [again] = await loadInkPages(store, NOTE, metaWith([id]));
  assert.equal(again!.chunk, null, "the erased page loads empty");
  assert.ok(!again!.unreadable);
  assert.equal(bucket.reads, 0, "a marked note never consults the bucket");
  assert.equal(await fs.stat(typedCore().inkChunkPath(NOTE_PATH, id)), null, "nothing was copied back");

  // A fresh store (an app restart) reads the marker from the folder, not memory.
  const restarted = new CopyOnReadInkChunkStore(folderStore(fs), bucket);
  const [cold] = await loadInkPages(restarted, NOTE, metaWith([id]));
  assert.equal(cold!.chunk, null);
  assert.equal(bucket.reads, 0);
});

test("migration: a chunk a git pull deleted stays deleted once the note is marked", async () => {
  const fs = await inkNoteFolder();
  const folder = folderStore(fs);
  const bucket = new CountedBucket();
  const id = typedCore().newInkChunkId();
  await bucket.write(NOTE, id, new Uint8Array([1]));
  const store = new CopyOnReadInkChunkStore(folder, bucket);
  await loadInkPages(store, NOTE, metaWith([id]));
  // Another device erased the page; the pull removes the file under us.
  await fs.remove(typedCore().inkChunkPath(NOTE_PATH, id));
  bucket.reads = 0;
  const [page] = await loadInkPages(store, NOTE, metaWith([id]));
  assert.equal(page!.chunk, null);
  assert.equal(bucket.reads, 0);
});

test("migration: a legacy page whose bucket read fails leaves the note unmarked and that page unreadable", async () => {
  const fs = await inkNoteFolder();
  const folder = folderStore(fs);
  const legacy = typedCore().newInkChunkId();
  const { store: bucket } = signedOutBucket();
  const store = new CopyOnReadInkChunkStore(folder, bucket);
  const [page] = await loadInkPages(store, NOTE, metaWith([legacy]));
  assert.equal(page!.unreadable, true, "a legacy page that may hold strokes is not saved over");
  assert.equal(await folder.isMigrated(NOTE), false);
});

test("offline / signed out: a new note's first page saves and reloads, and no empty strokes folder is made before it", async () => {
  const fs = await inkNoteFolder();
  const folder = folderStore(fs);
  const bucket = signedOutBucket();
  const store = new CopyOnReadInkChunkStore(folder, bucket.store);
  // A note made in 0.9.2: its header declares no pages.
  const [first] = await loadInkPages(store, NOTE, metaWith([]));
  assert.ok(!first!.unreadable, "a page minted here was never in the bucket");
  assert.equal(bucket.reads(), 0);
  assert.equal(await fs.stat("p/notes/sketch.ink"), null, "nothing declared, nothing to copy: no folder, no marker");
  await store.write(NOTE, first!.chunkId, new Uint8Array([4, 2]));
  assert.notEqual(await fs.stat(`p/notes/sketch.ink/${first!.chunkId}.inkb`), null, "the first stroke makes the folder");
  const [reloaded] = await loadInkPages(store, NOTE, metaWith([first!.chunkId]));
  assert.deepEqual([...reloaded!.chunk!], [4, 2]);
  // After a restart (a new store), the page is still read from the folder, never the bucket.
  const restarted = new CopyOnReadInkChunkStore(folderStore(fs), bucket.store);
  const [again] = await loadInkPages(restarted, NOTE, metaWith([first!.chunkId]));
  assert.deepEqual([...again!.chunk!], [4, 2]);
  assert.equal(bucket.reads(), 0);
});

test("offline / signed out: a page added to a legacy note saves, even while the legacy page cannot be read", async () => {
  const fs = await inkNoteFolder();
  const folder = folderStore(fs);
  const bucket = signedOutBucket();
  const store = new CopyOnReadInkChunkStore(folder, bucket.store);
  const legacy = typedCore().newInkChunkId();
  const pages = await loadInkPages(store, NOTE, metaWith([legacy]));
  assert.equal(pages[0]!.unreadable, true);

  // The host appends a blank page with a fresh id and draws on it.
  const added = typedCore().newInkChunkId();
  await store.write(NOTE, added, new Uint8Array([3]));
  const reloaded = await loadInkPages(store, NOTE, metaWith([legacy, added]));
  assert.equal(reloaded[0]!.unreadable, true);
  assert.deepEqual([...reloaded[1]!.chunk!], [3]);
  assert.ok(!reloaded[1]!.unreadable);

  // Its last stroke erased: still a writable, empty page, not an unreadable one.
  await store.remove(NOTE, added);
  const erased = await loadInkPages(store, NOTE, metaWith([legacy, added]));
  assert.equal(erased[1]!.chunk, null);
  assert.ok(!erased[1]!.unreadable);
  assert.equal(await folder.isMigrated(NOTE), false, "the legacy page is still owed a copy");
});

test("migration: a chunk that lands between the folder check and the copy is not overwritten", async () => {
  const fs = await inkNoteFolder();
  const id = typedCore().newInkChunkId();
  const path = typedCore().inkChunkPath(NOTE_PATH, id);
  /** A folder whose first miss is followed at once by a git pull that brings the chunk. */
  class PulledUnderUs extends FsInkChunkStore {
    writes = 0;
    private pulled = false;
    override async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
      const bytes = await super.read(noteId, chunkId);
      if (!bytes && !this.pulled) {
        this.pulled = true;
        await fs.mkdirp(typedCore().inkStrokesDir(NOTE_PATH));
        await fs.writeFile(path, new Uint8Array([7, 7, 7]));
      }
      return bytes;
    }
    override async write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void> {
      this.writes += 1;
      return super.write(noteId, chunkId, bytes);
    }
  }
  const folder = new PulledUnderUs(() => fs, new FolderInkNotes(() => fs));
  const bucket = new MemoryInkChunkStore();
  await bucket.write(NOTE, id, new Uint8Array([1]));
  const store = new CopyOnReadInkChunkStore(folder, bucket);
  assert.deepEqual([...(await store.read(NOTE, id))!], [7, 7, 7], "the pulled chunk wins");
  assert.equal(folder.writes, 0);
  assert.deepEqual([...(await fs.readFile(path))], [7, 7, 7]);
});
