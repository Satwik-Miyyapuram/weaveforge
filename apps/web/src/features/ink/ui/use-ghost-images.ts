"use client";

/**
 * The rail's ghost images (§4.7): one blob URL per non-live page that has a
 * background, fetched once and kept until the note closes.
 *
 * A ghost is only looked at, so a failure costs a blank ghost rather than a
 * broken flow — the page's image is still on its chunk when the page is
 * reached. The blobs outlive every render: one cleanup for the note's
 * lifetime, not per page, because a ghost map entry's URL is never re-created.
 */

import { useEffect, useRef, useState } from "react";
import { inkPageBackground } from "@weaveforge/core";

/** What the ghosts need from the host. */
export interface GhostImagesDeps {
  /** The vault, for the background bytes. */
  fetchBlob: (path: string) => Promise<Blob>;
  /** The pages' text layers, where a page's background is named. */
  textPagesRef: { current: string[] };
  /** How many pages the note has. */
  pageCount: number;
  /** 0-based: the live page, whose ghost is not needed. */
  pageIndex: number;
}

export function useGhostImages(deps: GhostImagesDeps) {
  const [ghostImages, setGhostImages] = useState<
    ReadonlyMap<number, string>
  >(new Map());
  const ghostImagesRef = useRef(ghostImages);
  ghostImagesRef.current = ghostImages;
  useEffect(
    () => () => {
      for (const url of ghostImagesRef.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );
  useEffect(() => {
    let live = true;
    const missing: [number, string][] = [];
    for (let index = 0; index < deps.pageCount; index += 1) {
      if (index === deps.pageIndex) continue;
      if (ghostImages.has(index)) continue;
      const path = inkPageBackground(deps.textPagesRef.current[index] ?? "");
      if (path) missing.push([index, path]);
    }
    if (missing.length === 0) return;
    void Promise.all(
      missing.map(async ([index, path]) => {
        try {
          const blob = await deps.fetchBlob(path);
          return [index, URL.createObjectURL(blob)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!live) return;
      const next = new Map(ghostImages);
      for (const entry of entries) if (entry) next.set(entry[0], entry[1]);
      setGhostImages(next);
    });
    return () => {
      live = false;
    };
    // The pages and the active index are what it depends on: the text layer's
    // own length is `pageCount`, and its per-page paths are stable once a
    // page has its image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.fetchBlob, deps.pageCount, deps.pageIndex]);
  return ghostImages;
}
