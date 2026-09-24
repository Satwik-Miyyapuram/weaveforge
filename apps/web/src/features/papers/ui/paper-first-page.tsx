"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getReaderPdfByteCache } from "@/features/reader/application/resolve-paper-pdf-for-reader";

/** Rendered first pages, by paper id — a page drawn once is not drawn again. */
const drawn = new Map<string, string>();

/**
 * The first page of the paper's PDF, as a picture of the record.
 *
 * Only from the copy already on this device: opening a paper's page must not
 * download its PDF, and a PDF that has never been opened has no copy here. In
 * that case the frame says so and offers the reader, which is where fetching
 * one is asked for.
 */
export function PaperFirstPage({
  paperId,
  caption,
  readerHref,
}: {
  paperId: string;
  caption: string;
  readerHref: string | null;
}) {
  const [url, setUrl] = useState<string | null>(() => drawn.get(paperId) ?? null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const known = drawn.get(paperId);
    setUrl(known ?? null);
    setMissing(false);
    if (known) return;
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await getReaderPdfByteCache()?.get(paperId);
        if (!bytes || bytes.byteLength === 0) throw new Error("not on this device");
        const { renderPdfPage, toPngBlob } = await import("@/features/ink/application/pdf-page-raster");
        const canvas = await renderPdfPage(bytes, 1, 480);
        const blob = await toPngBlob(canvas);
        const objectUrl = URL.createObjectURL(blob);
        drawn.set(paperId, objectUrl);
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const frame = url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="First page of the PDF" />
  ) : (
    <span className="record-page-empty">
      {missing ? (readerHref ? "Open the PDF once to see its first page here" : "No PDF on file") : ""}
    </span>
  );

  return (
    <figure className="record-page">
      {readerHref ? (
        <Link href={readerHref} className="record-page-frame" aria-label="Open in reader">
          {frame}
        </Link>
      ) : (
        <div className="record-page-frame">{frame}</div>
      )}
      <figcaption className="record-mono">{caption}</figcaption>
    </figure>
  );
}
