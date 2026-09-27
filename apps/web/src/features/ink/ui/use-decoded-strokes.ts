"use client";

import { useEffect, useRef, useState } from "react";
import { decodeInkChunk, pageFromChunk, type InkStroke } from "@weaveforge/core";
import { availableInkChunkCodec } from "../application/ink-chunk-codec";
import type { InkStoredPage } from "../application/ink-chunk-store";

export interface UseDecodedStrokesOptions {
  pages: readonly InkStoredPage[] | null;
  /** Bumped when a page's chunk is rewritten in place; the list stays the same. */
  version?: number;
  /**
   * The live page's strokes as the worker last listed them, which run ahead of
   * its saved chunk: a page just left keeps what was written on it.
   */
  live?: { pageIndex: number; strokes: readonly InkStroke[] } | null;
}

/**
 * Decodes and caches the ink strokes for pages in a note.
 *
 * What every page's SVG ink (§ink-page-ink) draws from, in Ink mode and in
 * Read mode alike.
 */
export function useDecodedStrokes({
  pages,
  version = 0,
  live,
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

  // The live page's own list, which a save has not reached yet.
  useEffect(() => {
    if (!live) return;
    setStrokesMap((prev) => {
      if (prev.get(live.pageIndex) === live.strokes) return prev;
      const next = new Map(prev);
      next.set(live.pageIndex, live.strokes);
      return next;
    });
  }, [live]);

  return strokesMap;
}
