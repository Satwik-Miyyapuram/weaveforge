"use client";

/**
 * The note's own saves: the header and body written late, the sidecar loaded
 * once (§4).
 *
 * Every stroke is saved late — a stroke ends, a timer starts, and when it
 * fires the worker hands back the page's chunk, which goes to the store, and
 * the body's header goes to `onSave` with the page count and order. Nothing
 * is written mid-stroke. The header and the body are read by one function
 * because two things must agree: what gets saved, and the attachment index a
 * page's chunk carries — the index counts the `vault:` refs in *this* body,
 * so a body built anywhere else would count a different one.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { awaitInkWrites, trackInkWrite } from "../application/ink-pending-writes";
import {
  joinInkTextLayer,
  newInkChunkId,
  writeInkNoteBody,
  type InkNoteMeta,
} from "@weaveforge/core";

import {
  loadInkPages,
  type InkChunkStore,
  type InkStoredPage,
} from "../application/ink-chunk-store";

/** What the saves need from the host. */
export interface InkNoteStoreDeps {
  /** The note whose sidecar holds the pages. */
  noteId: string;
  /** Where the body goes when a page, the order or the text layer changes. */
  onSave?: (body: string) => Promise<void>;
  /** The sidecar. */
  chunks: InkChunkStore;
  /** The note's header, as it will be written back. */
  metaRef: { current: InkNoteMeta };
  /** The pages, once the sidecar has answered. */
  pagesRef: { current: InkStoredPage[] | null };
  /** The text layer's pages, for the body (§4.2). */
  textPagesRef: { current: string[] };
  /** The worker's chunk bytes for the current page. */
  requestSave: () => Promise<Uint8Array | null>;
  /** 0-based: the page whose chunk a save writes. */
  pageIndex: number;
  /** How many pages the note has; a blank-page append lands after the last. */
  pageCount: number;
  /** The page count, kept by the host, grown by a load and by an insert. */
  setPageCount: (count: number) => void;
  /** The page index, clamped by a load and moved by a flip or an append. */
  setPageIndex: (index: number | ((index: number) => number)) => void;
}

/** How long after the last stroke the page is written. */
export const INK_SAVE_DELAY_MS = 1200;

export function useInkNoteStore(deps: InkNoteStoreDeps) {
  const {
    noteId,
    onSave,
    chunks,
    metaRef,
    pagesRef,
    textPagesRef,
    requestSave,
    pageIndex,
    pageCount,
    setPageCount,
    setPageIndex,
  } = deps;

  /**
   * The header and the body as they now stand.
   *
   * One function rather than two because the body is read for two things that
   * must agree: what gets saved, and the attachment index a page's chunk
   * carries (§4.8) — the index counts the `vault:` refs in this body, so a
   * body built anywhere else would count a different one.
   */
  const noteBody = useCallback((): { meta: InkNoteMeta; body: string } => {
    const pages = pagesRef.current ?? [];
    const meta: InkNoteMeta = {
      ...metaRef.current,
      pages: pages.length,
      pageOrder: pages.map((entry) => entry.chunkId),
    };
    return {
      meta,
      body: writeInkNoteBody(meta, joinInkTextLayer(textPagesRef.current)),
    };
  }, [metaRef, pagesRef, textPagesRef]);

  /** The body as the header and text layer now stand. */
  const saveBody = useCallback(async () => {
    if (!pagesRef.current || !onSave) return;
    const { meta, body: next } = noteBody();
    metaRef.current = meta;
    await onSave(next);
  }, [noteBody, onSave, metaRef, pagesRef]);

  /**
   * Bumped after each chunk write. The page list is a ref, so a written chunk
   * changes nothing React can see; the rail's static slots decode from this.
   */
  const [chunkVersion, setChunkVersion] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The save is late and coalesced: one write after the last stroke settles. */
  const persistRef = useRef<() => Promise<void>>(async () => {});
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persistRef.current();
    }, INK_SAVE_DELAY_MS);
  }, []);

  /** Write the current page's chunk, then the body. */
  const persist = useCallback(async () => {
    const pages = pagesRef.current;
    const current = pages?.[pageIndex];
    if (!pages || !current) return;
    const write = (async () => {
      const bytes = await requestSave();
      if (bytes) {
        await chunks.write(noteId, current.chunkId, bytes);
        current.chunk = bytes;
        setChunkVersion((v) => v + 1);
      }
      await saveBody();
    })();
    // Registered so whatever reads this note next waits for it (§ink-pending-writes).
    trackInkWrite(noteId, write);
    await write;
  }, [chunks, noteId, pageIndex, requestSave, saveBody, pagesRef]);
  persistRef.current = persist;

  /**
   * Flush a pending save before the page changes or the host goes away.
   *
   * `force` writes even with nothing scheduled: a stroke split at a page
   * edge has posted its `stroke-end` but the worker has not yet answered with
   * `stroke-committed`, so the save it would schedule is not there to flush.
   */
  const flushSave = useCallback((force = false) => {
    if (!saveTimer.current && !force) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void persistRef.current();
  }, []);
  useEffect(() => () => flushSave(), [flushSave]);

  /** Load the sidecar once; a note with nothing written gets one blank page. */
  useEffect(() => {
    let live = true;
    void awaitInkWrites(noteId)
      .then(() => loadInkPages(chunks, noteId, metaRef.current))
      .then((pages) => {
      if (!live) return;
      pagesRef.current = pages;
      setPageCount(pages.length);
      setPageIndex((index) => Math.min(index, pages.length - 1));
    });
    return () => {
      live = false;
    };
  }, [chunks, noteId, metaRef, pagesRef, setPageCount, setPageIndex]);

  /**
   * A new blank page after the last, in the note's order, and the index it
   * landed at.
   *
   * The index is returned rather than read back from `pageIndex` because
   * `setPageIndex` has not been applied when the caller continues: a caller
   * that means to fill the new page has to name it.
   */
  const appendPage = useCallback((): number => {
    const pages = pagesRef.current;
    if (!pages) return Math.max(0, pageCount - 1);
    flushSave();
    pages.push({
      chunkId: newInkChunkId(),
      chunk: null,
      paper: metaRef.current.paper,
    });
    textPagesRef.current.push("");
    setPageCount(pages.length);
    setPageIndex(pages.length - 1);
    return pages.length - 1;
  }, [flushSave, metaRef, pageCount, pagesRef, setPageCount, setPageIndex, textPagesRef]);

  /**
   * Blank pages after the last until the note has `count`, staying put.
   *
   * The text flow (§ink-text-flow) is what asks: text that runs past the last
   * page is shown on pages the note does not have yet, and a page the reader
   * can see is a page the pen can land on, so it is made real.
   */
  const ensurePageCount = useCallback(
    (count: number) => {
      const pages = pagesRef.current;
      if (!pages || pages.length >= count) return;
      while (pages.length < count) {
        pages.push({
          chunkId: newInkChunkId(),
          chunk: null,
          paper: metaRef.current.paper,
        });
        textPagesRef.current.push("");
      }
      setPageCount(pages.length);
      void saveBody();
    },
    [metaRef, pagesRef, saveBody, setPageCount, textPagesRef],
  );

  /** A new blank page after the last, in the note's order. */
  const onAddPage = useCallback(() => {
    appendPage();
    void saveBody();
  }, [appendPage, saveBody]);

  /** Go to a page by number, clamped to the pages the note actually has. */
  const goToPage = useCallback(
    (index: number) => {
      flushSave();
      setPageIndex(Math.max(0, Math.min(index, pageCount - 1)));
    },
    [flushSave, pageCount, setPageIndex],
  );

  return {
    noteBody,
    saveBody,
    scheduleSave,
    flushSave,
    chunkVersion,
    appendPage,
    ensurePageCount,
    onAddPage,
    goToPage,
  };
}
