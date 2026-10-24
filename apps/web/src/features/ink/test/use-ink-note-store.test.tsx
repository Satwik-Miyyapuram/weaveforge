/**
 * The note's saves never write over ink that could not be read (18-01, 21-17).
 *
 * A sidecar load that fails leaves the note with no pages, so nothing is
 * saved, and says so. A page whose chunk failed to read is shown empty and is
 * never written, since writing it would replace the stored strokes with only
 * the new ones.
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { defaultInkNoteMeta, newInkChunkId } from "@weaveforge/core";

import { MemoryInkChunkStore, type InkStoredPage } from "../application/ink-chunk-store";
import { useInkNoteStore } from "../ui/use-ink-note-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

/** A memory store that records writes, and can fail its listing or some reads. */
class RecordingStore extends MemoryInkChunkStore {
  writes: string[] = [];
  removes: string[] = [];
  constructor(private readonly fail: { list?: boolean; read?: Set<string> } = {}) {
    super();
  }
  override async list(noteId: string): Promise<string[]> {
    if (this.fail.list) throw new Error("EACCES: folder unreadable");
    return super.list(noteId);
  }
  override async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    if (this.fail.read?.has(chunkId)) throw new Error("EIO: read failed");
    return super.read(noteId, chunkId);
  }
  override async write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void> {
    this.writes.push(chunkId);
    return super.write(noteId, chunkId, bytes);
  }
  override async remove(noteId: string, chunkId: string): Promise<void> {
    this.removes.push(chunkId);
    return super.remove(noteId, chunkId);
  }
}

type Handle = ReturnType<typeof useInkNoteStore>;

const mounted: ReturnType<typeof create>[] = [];
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
});

/** Mount the hook on one page of `pageOrder`, the worker answering with `save`. */
function mount(chunks: RecordingStore, pageOrder: string[], save = { bytes: new Uint8Array([9]) as Uint8Array | null, cleared: false }) {
  const saved: string[] = [];
  const pagesRef: { current: InkStoredPage[] | null } = { current: null };
  let handle: Handle | null = null;
  // Stable across renders, as the host's refs and callbacks are.
  const metaRef = { current: { ...defaultInkNoteMeta(), pageOrder } };
  const textPagesRef = { current: [""] };
  const onSave = async (body: string) => void saved.push(body);
  const requestSave = async () => ({ ...save, pageIndex: 0 });
  const noop = () => {};
  function Probe() {
    handle = useInkNoteStore({
      noteId: NOTE,
      onSave,
      chunks,
      metaRef,
      pagesRef,
      textPagesRef,
      requestSave,
      pageIndex: 0,
      pageCount: 1,
      setPageCount: noop,
      setPageIndex: noop,
    });
    return null;
  }
  act(() => void mounted.push(create(createElement(Probe))));
  return { handle: () => handle!, pagesRef, saved };
}

/** Let the load, and any save it started, finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

test("a sidecar load that fails says so and saves nothing (21-17)", async () => {
  const chunks = new RecordingStore({ list: true });
  const { handle, pagesRef, saved } = mount(chunks, [newInkChunkId()]);
  await settle();
  assert.match(handle().loadError ?? "", /could not be loaded/);
  assert.equal(pagesRef.current, null);
  handle().flushSave(true);
  await settle();
  assert.deepEqual(chunks.writes, []);
  assert.deepEqual(saved, []);
});

test("a page that could not be read is never written over (18-01)", async () => {
  const id = newInkChunkId();
  const chunks = new RecordingStore({ read: new Set([id]) });
  await chunks.write(NOTE, id, new Uint8Array([1, 2, 3]));
  chunks.writes = [];
  const { handle, pagesRef } = mount(chunks, [id]);
  await settle();
  assert.equal(pagesRef.current?.[0]?.unreadable, true);
  assert.match(handle().loadError ?? "", /could not be read/);
  handle().flushSave(true);
  await settle();
  assert.deepEqual(chunks.writes, []);
  assert.deepEqual(chunks.removes, []);
});

test("an unreadable page is not removed when the worker reports it cleared", async () => {
  const id = newInkChunkId();
  const chunks = new RecordingStore({ read: new Set([id]) });
  await chunks.write(NOTE, id, new Uint8Array([1]));
  const { handle, pagesRef } = mount(chunks, [id], { bytes: null, cleared: true });
  await settle();
  // Force the guard the remove path checks, as a page that showed strokes would.
  pagesRef.current![0]!.chunk = new Uint8Array([1]);
  handle().flushSave(true);
  await settle();
  assert.deepEqual(chunks.removes, []);
});

test("a page that read cleanly is saved as before", async () => {
  const id = newInkChunkId();
  const chunks = new RecordingStore();
  await chunks.write(NOTE, id, new Uint8Array([1]));
  chunks.writes = [];
  const { handle, saved } = mount(chunks, [id]);
  await settle();
  assert.equal(handle().loadError, null);
  handle().flushSave(true);
  await settle();
  assert.deepEqual(chunks.writes, [id]);
  assert.deepEqual([...(await chunks.read(NOTE, id))!], [9]);
  assert.equal(saved.length, 1);
});
