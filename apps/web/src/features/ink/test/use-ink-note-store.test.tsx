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
import { awaitInkWrites } from "../application/ink-pending-writes";
import { INK_SAVE_FAILED, useInkNoteStore } from "../ui/use-ink-note-store";
import { useInkWorkerRpc, type InkSave } from "../ui/use-ink-worker-rpc";

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
function mount(
  chunks: RecordingStore,
  pageOrder: string[],
  save = { bytes: new Uint8Array([9]) as Uint8Array | null, cleared: false },
  requestSave: () => Promise<InkSave> = async () => ({ ...save, pageIndex: 0 }),
  onSaveBody?: (body: string) => Promise<void>,
) {
  const saved: string[] = [];
  const pagesRef: { current: InkStoredPage[] | null } = { current: null };
  let handle: Handle | null = null;
  // Stable across renders, as the host's refs and callbacks are.
  const metaRef = { current: { ...defaultInkNoteMeta(), pageOrder } };
  const textPagesRef = { current: pageOrder.map(() => "") };
  const onSave = onSaveBody ?? (async (body: string) => void saved.push(body));
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
  return { handle: () => handle!, pagesRef, textPagesRef, metaRef, saved };
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

type Log = { level: string; source: string; message: string; detail?: string };

/** Run with a desktop bridge that records app-log lines and unhandled rejections. */
async function withAppLog(run: (logs: Log[]) => Promise<void>): Promise<unknown[]> {
  const logs: Log[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (entry: Log) => void logs.push(entry) } };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run(logs);
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off("unhandledRejection", onUnhandled);
    g.window = original;
  }
  return unhandled;
}

test("a worker that goes away settles its pending save and export (21-14)", async () => {
  let rpc: ReturnType<typeof useInkWorkerRpc> | null = null;
  const sendRef = { current: () => {} };
  function Probe() {
    rpc = useInkWorkerRpc({ sendRef, initialPageSize: { width: 10, height: 10 } });
    return null;
  }
  act(() => void mounted.push(create(createElement(Probe))));
  const save = rpc!.requestSave();
  const png = rpc!.requestExport();
  act(() => rpc!.onEvent({ type: "disposed" }));
  assert.deepEqual(await save, { bytes: null, pageIndex: -1, cleared: false });
  assert.equal(await png, null);
});

test("a save the worker never made removes nothing (21-14)", async () => {
  const id = newInkChunkId();
  const chunks = new RecordingStore();
  await chunks.write(NOTE, id, new Uint8Array([1]));
  chunks.writes = [];
  const { handle, saved } = mount(chunks, [id], undefined, async () => ({ bytes: null, pageIndex: -1, cleared: false }));
  await settle();
  handle().flushSave(true);
  await settle();
  assert.deepEqual(chunks.writes, []);
  assert.deepEqual(chunks.removes, []);
  assert.deepEqual([...(await chunks.read(NOTE, id))!], [1]);
  assert.equal(saved.length, 1);
});

test("a save that fails is logged and said, and its write still settles (21-18)", async () => {
  const id = newInkChunkId();
  const chunks = new RecordingStore();
  let logs: Log[] = [];
  let message: string | null = null;
  const unhandled = await withAppLog(async (captured) => {
    logs = captured;
    const { handle } = mount(chunks, [id], undefined, () => Promise.reject(new Error("disk full")));
    await settle();
    handle().flushSave(true);
    await settle();
    await awaitInkWrites(NOTE);
    message = handle().loadError;
  });
  assert.deepEqual(unhandled, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.source, "ink");
  assert.match(logs[0]!.detail ?? "", /disk full/);
  assert.equal(message, INK_SAVE_FAILED);
});

test("added and filled-in pages each get a text page and the note's paper (21-11)", async () => {
  const chunks = new RecordingStore();
  const { handle, pagesRef, textPagesRef, metaRef } = mount(chunks, [newInkChunkId()]);
  await settle();
  act(() => void handle().onAddPage());
  act(() => handle().ensurePageCount(4));
  await settle();
  assert.equal(pagesRef.current!.length, 4);
  assert.equal(textPagesRef.current.length, 4);
  for (const page of pagesRef.current!.slice(1)) {
    assert.equal(page.chunk, null);
    assert.equal(page.paper, metaRef.current.paper);
  }
  assert.equal(new Set(pagesRef.current!.map((p) => p.chunkId)).size, 4);
});

test("a body save that fails is logged and resolves, so a loop of them goes on (21-24)", async () => {
  const chunks = new RecordingStore();
  let logs: Log[] = [];
  let message: string | null = null;
  let calls = 0;
  const unhandled = await withAppLog(async (captured) => {
    logs = captured;
    const { handle } = mount(chunks, [newInkChunkId()], undefined, undefined, async () => {
      calls += 1;
      throw new Error("offline");
    });
    await settle();
    for (let i = 0; i < 2; i++) await handle().saveBody();
    await act(async () => {});
    message = handle().loadError;
  });
  assert.deepEqual(unhandled, []);
  assert.equal(calls, 2);
  assert.equal(logs.length, 2);
  assert.match(logs[0]!.detail ?? "", /offline/);
  assert.equal(message, INK_SAVE_FAILED);
});
