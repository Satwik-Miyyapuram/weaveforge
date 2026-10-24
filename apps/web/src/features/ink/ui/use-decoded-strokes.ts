"use client";

import { useEffect, useRef, useState } from "react";
import {
  decodeInkChunkBody,
  inflateInkChunk,
  pageFromChunk,
  type InkStroke,
} from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
import { perfEnd, perfEndAfterPaint, perfStart } from "@/lib/perf-marks";
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

// Module-level stroke cache shared across Read and Ink modes.
const decoded = new WeakMap<Uint8Array, readonly InkStroke[]>();

/** How many strokes a chunk decoded to here, 0 if it has not been. */
export function decodedStrokeCount(chunk: Uint8Array | null): number {
  return chunk ? (decoded.get(chunk)?.length ?? 0) : 0;
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
  const liveRef = useRef(live);
  liveRef.current = live;

  // Decode chunks when `pages` changes.
  useEffect(() => {
    if (!pages) return;

    const allCached = pages.every(
      (entry) => !entry.chunk || decoded.has(entry.chunk),
    );
    if (allCached) {
      // Merge, so the live page's unsaved strokes survive.
      setStrokesMap((prev) => {
        const next = new Map(prev);
        const current = liveRef.current;
        pages.forEach((entry, index) => {
          if (current?.pageIndex === index) {
            next.set(index, current.strokes);
            return;
          }
          next.set(index, entry.chunk ? (decoded.get(entry.chunk) ?? []) : []);
        });
        return next;
      });
      return;
    }

    let cancelled = false;
    const codec = availableInkChunkCodec();
    const noteStart = perfStart();

    void (async () => {
      const results: { index: number; strokes: readonly InkStroke[] }[] = [];
      for (let index = 0; index < pages.length; index++) {
        if (cancelled) return;
        const entry = pages[index]!;
        if (!entry.chunk) {
          results.push({ index, strokes: [] as readonly InkStroke[] });
        } else {
          const cached = decoded.get(entry.chunk);
          if (cached) {
            results.push({ index, strokes: cached });
          } else {
            try {
              const inflateStart = perfStart();
              const { flags, body } = await inflateInkChunk(entry.chunk, codec);
              perfEnd("ink:inflate", inflateStart, entry.chunk.byteLength);

              const parseStart = perfStart();
              const view = decodeInkChunkBody(body);
              const page = pageFromChunk({ ...view, flags });
              const strokes = page.strokes ?? [];
              perfEnd("ink:parse", parseStart, strokes.length);

              decoded.set(entry.chunk, strokes);
              results.push({ index, strokes });
            } catch (err) {
              // Shown empty, as before; cached so it is said once, not per render (21-21).
              logToApp({ level: "warn", source: "ink", message: `Could not decode ink page ${entry.chunkId}`, detail: String(err) });
              decoded.set(entry.chunk, []);
              results.push({ index, strokes: [] as readonly InkStroke[] });
            }
          }
        }
        if (cancelled) return;
        if (index === 2 && pages.length > 3) {
          setStrokesMap((prev) => {
            const next = new Map(prev);
            for (const { index: itemIndex, strokes } of results) {
              next.set(itemIndex, strokes);
            }
            return next;
          });
        }
      }
      if (cancelled) return;
      perfEndAfterPaint("ink:note-paint", noteStart, results.length);
      setStrokesMap((prev) => {
        const next = new Map(prev);
        for (const { index: itemIndex, strokes } of results) {
          next.set(itemIndex, strokes);
        }
        return next;
      });
    })();

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
