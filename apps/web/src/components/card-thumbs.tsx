"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Paper, PaperSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";

const MAX_THUMBS = 3;

/**
 * A row of up to three small image thumbnails for an entity card. Presentational
 * — the caller resolves the URLs. A null entry renders a placeholder tile so the
 * row does not reflow as images decrypt in.
 */
function CardThumbs({ urls, total }: { urls: (string | null)[]; total?: number }) {
  if (urls.length === 0) return null;
  const extra = (total ?? urls.length) - urls.length;
  return (
    <div className="card-thumbs" aria-hidden>
      {urls.map((url, i) => (
        <span className="card-thumb" key={i}>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" loading="lazy" />
          ) : (
            <span className="card-thumb-loading" />
          )}
        </span>
      ))}
      {extra > 0 ? <span className="card-thumb card-thumb-more">+{extra}</span> : null}
    </div>
  );
}

/** `undefined` for a summary entry, which carries no metadata bag at all. */
function paperImagePaths(metadata: Paper["metadata"] | undefined): string[] {
  const raw = (metadata as Record<string, unknown> | undefined)?.["images"];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/**
 * First-N thumbnails for a paper card. Paper images are stored as encrypted
 * `paperimg:` paths, so they are fetched and decrypted here; only the first
 * few are ever requested.
 *
 * Takes either shape on purpose. A card in a list holds the summary projection,
 * which carries no `metadata`, so there is nothing to draw from — and the `in`
 * guard is what says so out loud instead of reading `metadata` off a projection
 * and getting `undefined` (review-2 F6). Entries the pinned/shared merge
 * hydrated with a full paper do have it, and those keep their thumbnails.
 */
export function PaperCardThumbs({ paper }: { paper: PaperSummary | Paper }) {
  const metadata = "metadata" in paper ? paper.metadata : undefined;
  const all = useMemo(() => paperImagePaths(metadata), [metadata]);
  const paths = useMemo(() => all.slice(0, MAX_THUMBS), [all]);
  const fetchBlob = useCallback(
    (path: string) =>
      getContainer()
        .papers.fetchImageBlob(path)
        .catch(() => null),
    [],
  );
  const urls = useBlobObjectUrls(paths, fetchBlob);
  if (paths.length === 0) return null;
  return <CardThumbs urls={paths.map((p) => urls.get(p) ?? null)} total={all.length} />;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i;

/**
 * First-N image thumbnails for an experiment card, from its artifact entries.
 *
 * An entry is either a hosted link or a storage path (`{userId}/{expId}/…`)
 * that only the artifact store can turn into something an `<img>` can load —
 * on the web a signed URL, on this computer a data URL. Rendered as-is, a
 * path resolved against the page and every SDK-logged figure was a broken
 * tile, so the paths are resolved here the way the detail view does.
 */
export function ExperimentCardThumbs({ artifacts }: { artifacts: readonly string[] }) {
  const images = useMemo(() => artifacts.filter((u) => IMAGE_EXT.test(u)), [artifacts]);
  const shown = useMemo(() => images.slice(0, MAX_THUMBS), [images]);
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const key = shown.join("\u0000");
  useEffect(() => {
    let cancelled = false;
    if (shown.length === 0) {
      setUrls([]);
      return;
    }
    setUrls(shown.map(() => null));
    void getContainer()
      .experiments.artifactViewUrls(shown)
      .then((resolved) => {
        if (!cancelled) setUrls(resolved);
      })
      .catch(() => {
        // Leave the placeholders rather than draw a broken image.
      });
    return () => {
      cancelled = true;
    };
    // `key` stands in for the array, as in the detail panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (shown.length === 0) return null;
  return <CardThumbs urls={urls.length ? urls : shown.map(() => null)} total={images.length} />;
}
