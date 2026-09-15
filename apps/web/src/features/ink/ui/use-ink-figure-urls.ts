"use client";

/**
 * The figures' images, fetched once per path (§figure).
 *
 * A blob URL per figure path is kept for the page being looked at; ghosts
 * and other pages fetch their own when they are looked at, and a URL already
 * here is not fetched again.
 */

import { useEffect, useState } from "react";

/** What the URLs need from the host. */
export interface InkFigureUrlsDeps {
  /** The vault, for the figure bytes. */
  fetchBlob: (path: string) => Promise<Blob>;
  /** The page's figures, whose paths are wanted. */
  figures: readonly { path: string }[];
}

export function useInkFigureUrls(deps: InkFigureUrlsDeps) {
  const [figureUrls, setFigureUrls] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  useEffect(() => {
    let live = true;
    const missing = [...new Set(deps.figures.map((figure) => figure.path))].filter(
      (path) => !figureUrls.has(path),
    );
    if (missing.length === 0) return;
    void Promise.all(
      missing.map(async (path) => {
        try {
          const blob = await deps.fetchBlob(path);
          return [path, URL.createObjectURL(blob)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!live) return;
      const next = new Map(figureUrls);
      for (const entry of entries) if (entry) next.set(entry[0], entry[1]);
      setFigureUrls(next);
    });
    return () => {
      live = false;
    };
    // The URLs themselves are what has been fetched; only new paths matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.fetchBlob, deps.figures]);

  return figureUrls;
}
