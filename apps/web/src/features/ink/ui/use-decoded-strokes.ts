"use client";

import { useEffect, useRef, useState } from "react";
import { decodeInkChunk, pageFromChunk, type InkPage, type InkStroke } from "@weaveforge/core";
import { availableInkChunkCodec } from "../application/ink-chunk-codec";
import type { InkStoredPage } from "../application/ink-chunk-store";

export interface UseDecodedStrokesOptions {
  pages: readonly InkStoredPage[] | null;
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
  activePageIndex,
  activeModel,
  strokesCount,
}: UseDecodedStrokesOptions): ReadonlyMap<number, readonly InkStroke[]> {
  const [strokesMap, setStrokesMap] = useState<ReadonlyMap<number, readonly InkStroke[]>>(
    new Map(),
  );
  const cacheRef = useRef(new Map<string, readonly InkStroke[]>());

  // Decode chunks when `pages` changes.
  useEffect(() => {
    if (!pages) return;
    let cancelled = false;
    const codec = availableInkChunkCodec();

    void Promise.all(
      pages.map(async (entry, index) => {
        if (!entry.chunk) return { index, strokes: [] as readonly InkStroke[] };
        const key = `${entry.chunkId}:${entry.chunk.length}`;
        const cached = cacheRef.current.get(key);
        if (cached) return { index, strokes: cached };
        try {
          const decoded = await decodeInkChunk(entry.chunk, codec);
          const page = pageFromChunk(decoded);
          const strokes = page.strokes ?? [];
          cacheRef.current.set(key, strokes);
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
  }, [pages]);

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
