"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getReaderPdfByteCache } from "@/features/reader/application/resolve-paper-pdf-for-reader";
import { folderRestored } from "@/features/workspace/application/workspace-folder";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { siteOf, type PaperPreview } from "../application/paper-preview";

/** Previews already made, by paper id — a page drawn once is not drawn again. */
const made = new Map<string, PaperPreview>();

/**
 * The paper's preview, from what is on this device only: opening a paper's
 * page must not download its PDF. A saved PDF gives its first page; failing
 * that, a saved web page gives its title and site.
 */
export function usePaperPreview(paperId: string): PaperPreview {
  const [preview, setPreview] = useState<PaperPreview>(() => made.get(paperId) ?? { kind: "loading" });

  useEffect(() => {
    const known = made.get(paperId);
    setPreview(known ?? { kind: "loading" });
    if (known) return;
    let cancelled = false;
    void loadPreview(paperId).then((next) => {
      if (next.kind !== "none") made.set(paperId, next);
      if (!cancelled) setPreview(next);
    });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  return preview;
}

async function loadPreview(paperId: string): Promise<PaperPreview> {
  // On a fresh launch the workspace folder may not be open yet; reading
  // before it is would look in the browser cache and find nothing.
  await folderRestored();
  const pdf = await firstPageImage(paperId);
  if (pdf) return { kind: "pdf", imageUrl: pdf };
  const page = await savedWebPage(paperId);
  if (page) return { kind: "page", title: page.title, site: siteOf(page.url) };
  return { kind: "none" };
}

async function firstPageImage(paperId: string): Promise<string | null> {
  let bytes: ArrayBuffer | undefined;
  try {
    bytes = (await getReaderPdfByteCache()?.get(paperId)) ?? undefined;
  } catch (err) {
    logPreviewFailure(paperId, "Reading the saved PDF", err);
    return null;
  }
  if (!bytes || bytes.byteLength === 0) return null;
  try {
    const { renderPdfPage, toPngBlob } = await import("@/features/ink/application/pdf-page-raster");
    const canvas = await renderPdfPage(bytes, 1, 480);
    return URL.createObjectURL(await toPngBlob(canvas));
  } catch (err) {
    logPreviewFailure(paperId, "Drawing the first page", err);
    return null;
  }
}

async function savedWebPage(paperId: string): Promise<{ title: string; url: string } | null> {
  try {
    const { paperHtmlStore } = await import("@/features/reader/infrastructure/paper-html-store");
    return (await paperHtmlStore()?.get(paperId)) ?? null;
  } catch (err) {
    logPreviewFailure(paperId, "Reading the saved web page", err);
    return null;
  }
}

function logPreviewFailure(paperId: string, step: string, err: unknown): void {
  logToApp({
    level: "warn",
    source: "papers.preview",
    message: `${step} for the paper preview failed`,
    detail: `paper ${paperId}\n${err instanceof Error ? (err.stack ?? describeRejection(err)) : describeRejection(err)}`,
  });
}

/**
 * The preview frame on the paper page: the first page of a saved PDF, or a
 * card for a saved web page, linked to the reader whenever it can open one.
 */
export function PaperFirstPage({
  preview,
  caption,
  readerHref,
}: {
  preview: PaperPreview;
  caption: string;
  readerHref: string | null;
}) {
  const frame =
    preview.kind === "pdf" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={preview.imageUrl} alt="First page of the PDF" />
    ) : preview.kind === "page" ? (
      <span className="record-page-card">
        <span className="record-page-card-title">{preview.title}</span>
        <span className="record-mono">{preview.site}</span>
      </span>
    ) : (
      <span className="record-page-empty">
        {preview.kind === "none" ? (readerHref ? "Open the PDF once to see its first page here" : "No PDF on file") : ""}
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
      <figcaption className="record-mono">{preview.kind === "page" ? "Saved web page" : caption}</figcaption>
    </figure>
  );
}
