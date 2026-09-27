"use client";

/**
 * The rail's page images (§4.7): one blob URL per page that has a background,
 * the live page's included, fetched once per path and kept until the note
 * closes or the page names another.
 *
 * A ghost is only looked at, so a failure costs a blank ghost rather than a
 * broken flow — the page's image is still on its chunk when the page is
 * reached. A URL lives until its page names another image or the note closes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { inkPageBackground } from "@weaveforge/core";

/** What the ghosts need from the host. */
export interface GhostImagesDeps {
  /** The vault, for the background bytes. */
  fetchBlob: (path: string) => Promise<Blob>;
  /** The pages' text layers, where a page's background is named. */
  textPagesRef: { current: string[] };
  /** How many pages the note has. */
  pageCount: number;
  /** 0-based: the live page. Its image is fetched too: the live sheet shows it. */
  pageIndex?: number;
}

export function useGhostImages(deps: GhostImagesDeps) {
  // By page index, with the path the URL was made from: a page whose image is
  // replaced or removed names a different path (or none), and its entry is
  // remade or dropped rather than showing the old picture.
  const [entries, setEntries] = useState<
    ReadonlyMap<number, { path: string; url: string }>
  >(new Map());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(
    () => () => {
      for (const entry of entriesRef.current.values()) URL.revokeObjectURL(entry.url);
    },
    [],
  );
  // Every page's background path, read afresh each render: the text layer is a
  // ref, so this key is what tells the effect that a page gained, changed or
  // lost its image (a PDF import, "Change the page image", "Remove").
  const paths = Array.from(
    { length: deps.pageCount },
    (_, index) => inkPageBackground(deps.textPagesRef.current[index] ?? "") ?? "",
  );
  const pathsKey = paths.join("\n");
  useEffect(() => {
    let live = true;
    const current = entriesRef.current;
    const stale = [...current].filter(([index, entry]) => paths[index] !== entry.path);
    const missing: [number, string][] = [];
    paths.forEach((path, index) => {
      if (path && current.get(index)?.path !== path) missing.push([index, path]);
    });
    if (missing.length === 0 && stale.length === 0) return;
    void Promise.all(
      missing.map(async ([index, path]) => {
        try {
          const blob = await deps.fetchBlob(path);
          return [index, { path, url: URL.createObjectURL(blob) }] as const;
        } catch {
          return null;
        }
      }),
    ).then((loaded) => {
      if (!live) {
        for (const entry of loaded) if (entry) URL.revokeObjectURL(entry[1].url);
        return;
      }
      const next = new Map(entriesRef.current);
      for (const [index, entry] of stale) {
        URL.revokeObjectURL(entry.url);
        next.delete(index);
      }
      for (const entry of loaded) if (entry) next.set(entry[0], entry[1]);
      setEntries(next);
    });
    return () => {
      live = false;
    };
    // `pathsKey` is `paths`, as a value React can compare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.fetchBlob, pathsKey]);
  return useMemo(() => {
    const urls = new Map<number, string>();
    for (const [index, entry] of entries) urls.set(index, entry.url);
    return urls as ReadonlyMap<number, string>;
  }, [entries]);
}
