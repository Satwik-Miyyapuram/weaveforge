"use client";

/**
 * The figures' images, fetched once per path (§figure).
 *
 * A blob URL per figure path is kept for the page being looked at; ghosts
 * and other pages fetch their own when they are looked at, and a URL already
 * here is not fetched again.
 *
 * A fetch is never cancelled. The list of figures is rebuilt on most renders
 * of the host (a stroke, a page turn, a caret move), and an effect that
 * dropped its result when its inputs changed would drop it every time — the
 * image stayed "pending" for as long as the note was being drawn on. The
 * paths in flight are remembered instead, so a re-run neither asks twice nor
 * throws the answer away.
 */

import { useEffect, useRef, useState } from "react";

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
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const wanted = new Set(deps.figures.map((figure) => figure.path));
    for (const path of wanted) {
      if (figureUrls.has(path) || inFlight.current.has(path)) continue;
      inFlight.current.add(path);
      void deps
        .fetchBlob(path)
        .then((blob) => {
          if (!mounted.current) return;
          const url = URL.createObjectURL(blob);
          setFigureUrls((current) => new Map(current).set(path, url));
        })
        .catch(() => {
          // A missing asset is a frame with nothing in it, not a failure of
          // the page. Forgetting the path lets a later render try again.
        })
        .finally(() => inFlight.current.delete(path));
    }
    // The URLs themselves are what has been fetched; only new paths matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.fetchBlob, deps.figures]);

  return figureUrls;
}
