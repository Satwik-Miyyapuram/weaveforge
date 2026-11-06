"use client";

import { useCallback, useState } from "react";
import { getContainer } from "@/bootstrap";
import { ImageViewer } from "@/components/image-viewer";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";

function imagePaths(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.images;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** Read-only thumbnails for images on a paper shared with the current user. */
export function SharedPaperImages({ metadata }: { metadata?: Record<string, unknown> }) {
  const paths = imagePaths(metadata);
  const fetchBlob = useCallback(
    (path: string) =>
      getContainer()
        .papers.fetchImageBlob(path)
        .catch(() => null),
    [],
  );
  const urls = useBlobObjectUrls(paths, fetchBlob);
  const [open, setOpen] = useState<number | null>(null);

  if (paths.length === 0) return null;

  return (
    <div className="paper-images shared-paper-images">
      <div className="image-grid">
        {paths.map((p, i) => (
          <figure key={p} className="image-thumb">
            {urls.get(p) ? (
              <a
                href={urls.get(p)}
                title="Open full size"
                onClick={(e) => {
                  // A blob address cannot open in a new window, so every click opens the viewer.
                  e.preventDefault();
                  setOpen(i);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls.get(p)} alt="Paper figure" loading="lazy" />
              </a>
            ) : (
              <span className="image-loading" aria-hidden />
            )}
          </figure>
        ))}
      </div>
      {open !== null && (
        <ImageViewer
          images={paths.map((p) => ({ src: urls.get(p) ?? "", label: "Paper figure" }))}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
