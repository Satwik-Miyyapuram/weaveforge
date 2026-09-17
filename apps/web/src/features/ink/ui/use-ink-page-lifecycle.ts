"use client";

/**
 * What happens when the page changes (§4.8, §figure): the background the
 * worker is handed, the figures the render mirrors, and the page the worker
 * is told to load.
 *
 * The text layer is the model for all three — a page's background is named
 * on its first line, its figures sit in their own block, and the strokes
 * live on the chunk the sidecar names — so each effect reads the layer and
 * writes the worker or the render's copy, never the other way round.
 */

import { useEffect } from "react";
import {
  inkAttachmentIndex,
  inkPageBackground,
  inkPageFigures,
  type InkNoteMeta,
} from "@weaveforge/core";

import type { InkWorkerMessage } from "../application/capture-protocol";
import type { InkStoredPage } from "../application/ink-chunk-store";
import type { FigureGeometry } from "@weaveforge/core";
import type { InkPage } from "@weaveforge/core";

/** What the page change needs from the host. */
export interface InkPageLifecycleDeps {
  /** The worker's door. */
  send: (message: InkWorkerMessage, transfer?: Transferable[]) => void;
  /** The vault, for the background bytes. */
  fetchBlob: (path: string) => Promise<Blob>;
  /** The whole body, because the attachment index counts its `vault:` refs. */
  noteBody: () => string;
  /** 0-based: the page being loaded. */
  pageIndex: number;
  /** How many pages the note has; 0 means the sidecar has not answered. */
  pageCount: number;
  /** The pages, once the sidecar has answered. */
  pagesRef: { current: InkStoredPage[] | null };
  /** The note's header, for the recognition engine a page's lines use. */
  metaRef: { current: InkNoteMeta };
  /** The pages' text layers, where a background and figures are named. */
  textPagesRef: { current: string[] };
  /** The page's stroke count, reset on a load. */
  setStrokes: (count: number) => void;
  /** The lasso's selection, cleared on a load. */
  setSelection: (indices: number[]) => void;
  /** The current page's background attachment, for the bar's two buttons. */
  setBackgroundPath: (path: string | null) => void;
  /** The page's figures, replaced wholesale on a page change. */
  setFigures: (figures: readonly FigureGeometry[]) => void;
  /** The figure whose controls are open, closed by a page change. */
  setFigureControls: (index: number | null) => void;
  /** The worker's model, for the text column's earlier lines. */
  requestModel: () => Promise<InkPage>;
  /** Start a page's recognition state over. */
  recognitionReset: () => void;
  /**
   * A model arrived for the page just loaded. Must be stable across renders
   * (the recognition hook's own `useCallback`s), which is what keeps the
   * load effect from re-running itself into an update loop.
   */
  recognitionOnModelLoaded: (
    model: InkPage,
    engine: InkNoteMeta["engine"],
  ) => void;
}

export function useInkPageLifecycle(deps: InkPageLifecycleDeps) {
  const {
    send,
    fetchBlob,
    noteBody,
    pageIndex,
    pageCount,
    pagesRef,
    metaRef,
    textPagesRef,
    setStrokes,
    setSelection,
    setBackgroundPath,
    setFigures,
    setFigureControls,
    requestModel,
    recognitionReset,
    recognitionOnModelLoaded,
  } = deps;

  /**
   * The page's background (§4.8): the attachment its text layer names on its
   * first line, fetched and decoded here, handed to the worker as a bitmap.
   * The worker draws it under the strokes on screen and in an export, and is
   * told the attachment's index too, so the page it saves keeps the mirror the
   * chunk header carries. A page without one clears the last page's.
   */
  useEffect(() => {
    if (pageCount === 0) return;
    const path = inkPageBackground(textPagesRef.current[pageIndex] ?? "");
    const index = inkAttachmentIndex(noteBody(), path);
    setBackgroundPath(path);
    send({ type: "set-background", image: null, index });
    if (!path) return;
    let live = true;
    void fetchBlob(path)
      .then((blob) => createImageBitmap(blob))
      .then((image) => {
        if (!live) {
          image.close();
          return;
        }
        send({ type: "set-background", image, index }, [image]);
      })
      .catch(() => {
        // A missing attachment is a page without its background, not a broken note.
      });
    return () => {
      live = false;
    };
    // `pageCount` is in the list so the effect runs once the sidecar has answered.
  }, [fetchBlob, noteBody, pageCount, pageIndex, send, setBackgroundPath, textPagesRef]);

  /**
   * The page's figures, read out of its text layer when the page changes
   * (§figure). The text layer is the model; this state is the render's copy,
   * replaced wholesale on a page change and written back by
   * `onFiguresChange` on every drag's end — never edited in place, so the two
   * cannot drift apart.
   */
  useEffect(() => {
    setFigures(inkPageFigures(textPagesRef.current[pageIndex] ?? ""));
    // The controls belong to a figure of *this* page; its index is not one
    // of the next page's, so the page change closes them.
    setFigureControls(null);
  }, [pageIndex, setFigureControls, setFigures, textPagesRef]);

  /**
   * Tell the worker which page we are on, hand it the bytes, and read its line
   * table back so the text column shows what an earlier run left.
   */
  useEffect(() => {
    const current = pagesRef.current?.[pageIndex];
    if (!current) return;
    send({ type: "load-page", pageIndex, chunk: current.chunk });
    setStrokes(0);
    setSelection([]);
    recognitionReset();
    let live = true;
    void requestModel().then((model) => {
      if (live) recognitionOnModelLoaded(model, metaRef.current.engine);
    });
    return () => {
      live = false;
    };
    // `pageCount` is in the list so the effect runs once the sidecar has answered.
  }, [
    pageCount,
    pageIndex,
    pagesRef,
    metaRef,
    requestModel,
    recognitionOnModelLoaded,
    recognitionReset,
    send,
    setSelection,
    setStrokes,
  ]);
}
