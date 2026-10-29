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

import { logToApp } from "@/lib/error-report/app-log";

import { awaitInkWrites, trackInkWrite } from "../application/ink-pending-writes";
import type { InkSave } from "./use-ink-worker-rpc";
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
  requestSave: () => Promise<InkSave>;
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

/** Shown when the sidecar load failed: no page is known, so nothing is saved. */
export const INK_LOAD_FAILED =
  "This note's ink could not be loaded, so nothing drawn here will be saved. Close and reopen the note to try again.";
/** Shown when a page's save failed: what is on screen may not be stored. */
export const INK_SAVE_FAILED =
  "The last change to this note's ink could not be saved. Keep the note open and draw again to retry.";
/** Shown when some pages failed to read: they show empty and are not saved. */
export const INK_PAGES_UNREADABLE =
  "Some pages could not be read. They show empty, and nothing drawn on them will be saved until the note is reopened.";

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

  /** Why the note's ink is not all there, or not all saved, when it is not. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A save that failed: logged and shown, never dropped (21-18, 21-24). */
  const reportSaveFailure = useCallback(
    (err: unknown) => {
      logToApp({ level: "error", source: "ink", message: `Could not save the ink of ${noteId}`, detail: String(err) });
      setLoadError(INK_SAVE_FAILED);
    },
    [noteId],
  );

  /** The body as the header and text layer now stand. Never rejects: a failure is reported. */
  const saveBody = useCallback(async () => {
    if (!pagesRef.current || !onSave) return;
    const { meta, body: next } = noteBody();
    metaRef.current = meta;
    await onSave(next).catch(reportSaveFailure);
  }, [noteBody, onSave, metaRef, pagesRef, reportSaveFailure]);

  /**
   * Bumped after each chunk write. The page list is a ref, so a written chunk
   * changes nothing React can see; the rail's static slots decode from this.
   */
  const [chunkVersion, setChunkVersion] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The save is late and coalesced: one write after the last stroke settles. */
  const persistRef = useRef<() => Promise<void>>(async () => {});
  /** Run the save; a failure is reported, never dropped (21-18). */
  const runPersist = useCallback(() => {
    persistRef.current().catch(reportSaveFailure);
  }, [reportSaveFailure]);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      runPersist();
    }, INK_SAVE_DELAY_MS);
  }, [runPersist]);

  /** Write the current page's chunk, then the body. */
  const persist = useCallback(async () => {
    const pages = pagesRef.current;
    const current = pages?.[pageIndex];
    if (!pages || !current) return;
    const write = (async () => {
      const saved = await requestSave();
      // A page whose chunk failed to read still has its strokes in the store;
      // writing or removing it would lose them (18-01). The body is still saved.
      const writable = !current.unreadable;
      if (writable && saved.bytes) {
        await chunks.write(noteId, current.chunkId, saved.bytes);
        current.chunk = saved.bytes;
        setChunkVersion((v) => v + 1);
      } else if (writable && saved.cleared && saved.pageIndex === pageIndex && current.chunk) {
        // The last stroke went: drop the stored page so it does not come back.
        await chunks.remove(noteId, current.chunkId);
        current.chunk = null;
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
    runPersist();
  }, [runPersist]);
  useEffect(() => () => flushSave(), [flushSave]);

  /**
   * Load the sidecar once; a note with nothing written gets one blank page.
   * A load that fails leaves the pages unknown, so nothing is saved (21-17).
   */
  useEffect(() => {
    let live = true;
    setLoadError(null);
    void awaitInkWrites(noteId)
      .then(() => loadInkPages(chunks, noteId, metaRef.current))
      .then((pages) => {
        if (!live) return;
        pagesRef.current = pages;
        setPageCount(pages.length);
        setPageIndex((index) => Math.min(index, pages.length - 1));
        if (pages.some((page) => page.unreadable)) setLoadError(INK_PAGES_UNREADABLE);
      })
      .catch((err: unknown) => {
        logToApp({ level: "error", source: "ink", message: `Could not load the ink of ${noteId}`, detail: String(err) });
        if (live) setLoadError(INK_LOAD_FAILED);
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
  /** One blank page, with its text page, after the last (21-11). */
  const pushBlankPage = useCallback(
    (pages: InkStoredPage[]) => {
      pages.push({ chunkId: newInkChunkId(), chunk: null, paper: metaRef.current.paper });
      textPagesRef.current.push("");
    },
    [metaRef, textPagesRef],
  );

  const appendPage = useCallback((): number => {
    const pages = pagesRef.current;
    if (!pages) return Math.max(0, pageCount - 1);
    flushSave();
    pushBlankPage(pages);
    setPageCount(pages.length);
    setPageIndex(pages.length - 1);
    return pages.length - 1;
  }, [flushSave, pageCount, pagesRef, pushBlankPage, setPageCount, setPageIndex]);

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
      while (pages.length < count) pushBlankPage(pages);
      setPageCount(pages.length);
      void saveBody();
    },
    [pagesRef, pushBlankPage, saveBody, setPageCount],
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
    loadError,
  };
}
