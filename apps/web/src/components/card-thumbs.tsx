"use client";

import { useCallback, useMemo } from "react";
import type { Paper } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { useDecryptedObjectUrls } from "@/lib/use-decrypted-asset";

const MAX_THUMBS = 3;

/**
 * A row of up to three small image thumbnails for an entity card. Presentational
 * — the caller resolves the URLs. A null entry renders a placeholder tile so the
 * row does not reflow as images decrypt in.
 */
export function CardThumbs({ urls, total }: { urls: (string | null)[]; total?: number }) {
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

function paperImagePaths(metadata: Paper["metadata"]): string[] {
  const raw = (metadata as Record<string, unknown> | undefined)?.["images"];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/**
 * First-N thumbnails for a paper card. Paper images are stored as encrypted
 * `paperimg:` paths, so they are fetched and decrypted here; only the first
 * few are ever requested.
 */
export function PaperCardThumbs({ paper }: { paper: Paper }) {
  const all = useMemo(() => paperImagePaths(paper.metadata), [paper.metadata]);
  const paths = useMemo(() => all.slice(0, MAX_THUMBS), [all]);
  const fetchBlob = useCallback(
    (path: string) =>
      getContainer()
        .papers.fetchImageBlob(path)
        .catch(() => null),
    [],
  );
  const urls = useDecryptedObjectUrls(paths, fetchBlob);
  if (paths.length === 0) return null;
  return <CardThumbs urls={paths.map((p) => urls.get(p) ?? null)} total={all.length} />;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i;

/** First-N image thumbnails for an experiment card, from its artifact URLs. */
export function ExperimentCardThumbs({ artifacts }: { artifacts: readonly string[] }) {
  const images = artifacts.filter((u) => IMAGE_EXT.test(u));
  if (images.length === 0) return null;
  return <CardThumbs urls={images.slice(0, MAX_THUMBS)} total={images.length} />;
}
