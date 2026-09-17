"use client";

import { useEffect, useRef, useState } from "react";
import { decodeInkChunk, pageFromChunk, type InkPage, type InkStroke } from "@weaveforge/core";
import { availableInkChunkCodec } from "../application/ink-chunk-codec";
import type { InkStoredPage } from "../application/ink-chunk-store";

export interface UseDecodedStrokesOptions {
  pages: readonly InkStoredPage[] | null;
  /** Bumped when a page's chunk is rewritten in place; the list stays the same. */
  version?: number;
  activePageIndex: number;
  activeModel?: InkPage | null;
  strokesCount?: number;
}

/**
 * Decodes and caches the ink strokes for pages in a note.
 *
 * Used to render strokes on adjacent pages (prev and next) in the 3-page continuous
 * window, as well as on all pages in Read mode.
 */
export function useDecodedStrokes({
  pages,
  version = 0,
  activePageIndex,
  activeModel,
  strokesCount,
}: UseDecodedStrokesOptions): ReadonlyMap<number, readonly InkStroke[]> {
  const [strokesMap, setStrokesMap] = useState<ReadonlyMap<number, readonly InkStroke[]>>(
    new Map(),
  );
  // Keyed by the bytes themselves: a rewritten chunk is a new array, and two
  // saves of the same length are not the same page.
  const cacheRef = useRef(new WeakMap<Uint8Array, readonly InkStroke[]>());

  // Decode chunks when `pages` changes.
  useEffect(() => {
    if (!pages) return;
    let cancelled = false;
    const codec = availableInkChunkCodec();

    void Promise.all(
      pages.map(async (entry, index) => {
        if (!entry.chunk) return { index, strokes: [] as readonly InkStroke[] };
        const cached = cacheRef.current.get(entry.chunk);
        if (cached) return { index, strokes: cached };
        try {
          const decoded = await decodeInkChunk(entry.chunk, codec);
          const page = pageFromChunk(decoded);
          const strokes = page.strokes ?? [];
          cacheRef.current.set(entry.chunk, strokes);
          return { index, strokes };
        } catch {
          return { index, strokes: [] as readonly InkStroke[] };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setStrokesMap((prev) => {
        const next = new Map(prev);
        for (const { index, strokes } of results) {
          next.set(index, strokes);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [pages, version]);

  // Keep active page's strokes in sync when activeModel changes.
  useEffect(() => {
    if (!activeModel?.strokes) return;
    setStrokesMap((prev) => {
      const next = new Map(prev);
      next.set(activePageIndex, activeModel.strokes);
      return next;
    });
  }, [activePageIndex, activeModel, strokesCount]);

  return strokesMap;
}
