"use client";

/**
 * The paper half of the reader: the source ladder, the paper's annotations,
 * and `PdfReader` over the result.
 *
 * Lifted out of `ReaderScreen` so a paper tab in the workspace can show its
 * PDF in place — the third mode beside Edit and Read — without a second
 * route. The route keeps its header, split pane and activity centre and
 * renders this for the document; the workspace renders only this.
 *
 * "Load PDF…" takes a file from the user and writes its bytes to the byte
 * cache under the paper id: the folder store on desktop, IndexedDB on the
 * web. The ladder's cache rung then wins on the next resolve, which is how a
 * paper with no open-access source gets a PDF at all.
 */

import { useEffect, useRef, useState } from "react";
import type { PdfLocus, QuotationType, ReaderAnnotation } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { PdfReader } from "./pdf-reader";
import { proxiedPdfUrl } from "../application/sanitize-reader-url";
import {
  downloadPaperPdfToCache,
  isStoredPdfUrl,
  evictReaderPdfCache,
  getReaderPdfByteCache,
  resolvePaperPdfSourceForReader,
} from "../application/resolve-paper-pdf-for-reader";
import {
  pdfDownloadNeedsConsent,
  pdfDownloadRemembered,
  rememberPdfDownload,
} from "../application/pdf-download-consent";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { AnnotationSidebar } from "./annotation-sidebar";
import { projectZoteroAnnotations } from "../application/project-zotero-annotations";
import { mergeReaderAnnotations } from "../application/merge-reader-annotations";
import type { ZoteroAnnotation } from "@/features/papers/domain/zotero";
import { formatError } from "@/lib/format-error";

export interface PaperPdfPaneProps {
  /** The paper whose PDF to show; `null` with `pdfUrl` shows a bare URL. */
  paperId: string | null;
  /** A direct https PDF, for the route's `?pdf=` form. Ignored with a paper. */
  pdfUrl?: string | null;
  locus?: PdfLocus;
  page?: number;
  /** The route's activity log; the workspace does not keep one. */
  onActivity?: (kind: string, message: string) => void;
  /** The paper's title once known, for the route's header. */
  onTitle?: (title: string | null) => void;
  /** The annotations on screen, for the route's batch tools. */
  onAnnotations?: (annotations: ReaderAnnotation[]) => void;
  /** Rendered beside the document when present — the route's split pane. */
  aside?: React.ReactNode;
  /** Whether "Load PDF…" is offered. On for a paper. */
  allowLoad?: boolean;
}

export function PaperPdfPane({
  paperId,
  pdfUrl: pdfFromParam = null,
  locus,
  page,
  onActivity,
  onTitle,
  onAnnotations,
  aside,
  allowLoad = true,
}: PaperPdfPaneProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(paperId ? null : pdfFromParam);
  const [pdfRevokeUrl, setPdfRevokeUrl] = useState<string | null>(null);
  /**
   * Paper whose cached bytes were rejected by pdf.js, so the ladder is asked to
   * skip the cache for it. Held per paper rather than as a bare flag, so it
   * cannot leak into the next paper and force an unnecessary refetch.
   */
  const [cacheSkippedFor, setCacheSkippedFor] = useState<string | null>(null);
  /** Bumped after a load, so the ladder runs again and finds the new bytes. */
  const [generation, setGeneration] = useState(0);
  const [contentHash, setContentHash] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [quotationTypes, setQuotationTypes] = useState<Map<string, QuotationType>>(new Map());
  const [loading, setLoading] = useState(Boolean(paperId));
  const [error, setError] = useState<string | null>(null);
  /**
   * A publisher URL the ladder resolved for the no-account copy, held until
   * the person says to fetch it. Nothing leaves this computer before that.
   */
  const [pendingDownload, setPendingDownload] = useState<string | null>(null);
  // The paper a fetch already ran for. A store that takes the bytes but does
  // not answer with them next time round would otherwise fetch forever.
  const fetchedFor = useRef<string | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activityRef = useRef(onActivity);
  activityRef.current = onActivity;

  useEffect(() => onTitle?.(title), [onTitle, title]);
  useEffect(() => onAnnotations?.(annotations), [onAnnotations, annotations]);

  useEffect(() => {
    setError(null);
    setTitle(null);
    setPendingDownload(null);
    // Drop the previous paper's annotations before loading the next one.
    // Without this they stay mounted over the new PDF at the old paper's
    // coordinates, and survive indefinitely if the new load fails.
    setAnnotations([]);
    setQuotationTypes(new Map());
    setContentHash("");
    if (!paperId) {
      setPdfUrl(pdfFromParam);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let revokeOnCancel: string | null = null;
    setLoading(true);
    setPdfUrl(null);
    void getContainer()
      .papers.getPaper(paperId)
      .then(async (paper) => {
        if (cancelled) return;
        setTitle(paper?.title ?? null);
        if (!paper) {
          setError("Paper not found or inaccessible.");
          return;
        }
        // Resolve the source first: the ladder is what knows the content hash,
        // and the projection needs it to stamp each Zotero rect with the file
        // it was captured against.
        const resolution = await resolvePaperPdfSourceForReader(
          {
            id: paper.id,
            url: paper.url,
            arxivId: paper.arxivId,
            doi: paper.doi,
            pdfPath: paper.pdfPath,
            metadata: paper.metadata,
          },
          { skipCache: cacheSkippedFor === paper.id },
        );
        if (cancelled) {
          if (resolution.ok && "revokeUrl" in resolution && resolution.revokeUrl) {
            URL.revokeObjectURL(resolution.revokeUrl);
          }
          return;
        }
        const hash = (resolution.ok ? resolution.hit.contentHash?.trim() : "") || "";
        setContentHash(hash);

        const rawAnns = (paper.metadata?.["annotations"] as ZoteroAnnotation[] | undefined) ?? [];
        const projected = projectZoteroAnnotations(rawAnns, { contentHash: hash });
        let local: ReaderAnnotation[] = [];
        try {
          local = await getContainer().papers.listReaderAnnotations(paper.id);
        } catch {
          local = [];
        }
        if (!cancelled) setAnnotations(mergeReaderAnnotations(projected, local));
        try {
          const types = await getContainer().papers.listAnnotationQuotationTypesForPaper(paper.id);
          if (!cancelled) {
            setQuotationTypes(new Map(types.map((t) => [t.annotationKey, t.quotationType])));
          }
        } catch {
          if (!cancelled) setQuotationTypes(new Map());
        }
        if (resolution.ok && isLocalMode() && !isStoredPdfUrl(resolution.hit.url)) {
          // The no-account copy fetches into its own store, on request, and
          // then opens from there — so the paper is on disk for next time and
          // nothing is fetched behind the person's back.
          if (fetchedFor.current === paper.id) {
            setError("The PDF was fetched but could not be kept on this computer.");
          } else if (pdfDownloadRemembered()) {
            await fetchPending(paper.id, resolution.hit.url);
          } else {
            setPendingDownload(resolution.hit.url);
          }
        } else if (resolution.ok) {
          setPdfUrl(resolution.hit.url);
          if ("revokeUrl" in resolution && resolution.revokeUrl) {
            revokeOnCancel = resolution.revokeUrl;
            setPdfRevokeUrl(resolution.revokeUrl);
          } else {
            setPdfRevokeUrl(null);
          }
        } else {
          setError("This paper has no PDF URL the reader can open (HTML landing pages are skipped).");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(formatError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (revokeOnCancel) URL.revokeObjectURL(revokeOnCancel);
    };
  }, [paperId, pdfFromParam, cacheSkippedFor, generation]);

  /** Fetch a publisher's PDF into the store, then run the ladder again. */
  async function fetchPending(id: string, url: string) {
    setDownloading(true);
    try {
      const host = new URL(url).hostname;
      const ok = await downloadPaperPdfToCache(id, url);
      fetchedFor.current = id;
      if (!ok) {
        setError(`${host} did not answer with a PDF for this paper.`);
        return;
      }
      activityRef.current?.("reader", `Fetched the PDF from ${host}; it is kept on this computer.`);
      setPendingDownload(null);
      // Loading again before the ladder re-runs: the effect only sets it on
      // its next pass, and the frame in between would say "Nothing to show".
      setLoading(true);
      setGeneration((n) => n + 1);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setDownloading(false);
    }
  }

  function acceptDownload() {
    if (!paperId || !pendingDownload) return;
    if (rememberChoice) rememberPdfDownload(true);
    void fetchPending(paperId, pendingDownload);
  }

  /**
   * A cached copy pdf.js refused to open. Drop it and re-run the ladder without
   * the cache tier, which resolves the paper's real PDF URL.
   *
   * Seen on mobile as "Unexpected server response (0)" against a blob: URL —
   * the entry can be truncated by a storage eviction mid-write, or its bytes
   * reclaimed under memory pressure, and it would then be re-served on every
   * future visit. Recovering here means a bad entry costs one refetch instead
   * of leaving the paper permanently unopenable.
   */
  function handleSourceFailure(failedUrl: string) {
    if (!paperId) return;
    activityRef.current?.("reader", "Cached PDF could not be opened — refetching the original.");
    if (failedUrl.startsWith("blob:")) URL.revokeObjectURL(failedUrl);
    setPdfRevokeUrl(null);
    void evictReaderPdfCache(paperId);
    setCacheSkippedFor(paperId);
  }

  useEffect(() => {
    return () => {
      if (pdfRevokeUrl) URL.revokeObjectURL(pdfRevokeUrl);
    };
  }, [pdfRevokeUrl]);

  /** The user's own copy of the paper, kept under its id from now on. */
  async function loadPdf(file: File) {
    if (!paperId) return;
    const cache = getReaderPdfByteCache();
    if (!cache) {
      setError("This browser cannot keep a PDF — open a workspace folder first.");
      return;
    }
    try {
      await cache.set(paperId, await file.arrayBuffer());
      activityRef.current?.("reader", `Loaded ${file.name} for this paper.`);
      setCacheSkippedFor(null);
      setGeneration((n) => n + 1);
    } catch (err) {
      setError(formatError(err));
    }
  }

  const canLoad = allowLoad && Boolean(paperId);
  const loadButton = canLoad ? (
    <button
      type="button"
      className="btn-secondary btn-sm"
      title="Use a PDF from this device for this paper"
      onClick={() => fileInputRef.current?.click()}
    >
      Load PDF…
    </button>
  ) : null;

  return (
    <div className="paper-pdf-pane">
      {canLoad ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void loadPdf(file);
          }}
        />
      ) : null}
      {downloading ? (
        <ScreenLoader status="Fetching PDF…" />
      ) : (
        loading && <ScreenLoader status="Resolving source…" />
      )}
      {!loading && !downloading && !error && pendingDownload && (
        <div className="card empty-state">
          <h2>PDF not on this computer</h2>
          <p>
            Fetch it from {new URL(pendingDownload).hostname}? It is kept here afterwards, so
            the paper opens offline from then on.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn-primary" onClick={acceptDownload}>
              Fetch PDF
            </button>
            {loadButton}
          </div>
          {pdfDownloadNeedsConsent() && (
            <label className="field-inline">
              <input
                type="checkbox"
                className="themed-check"
                checked={rememberChoice}
                onChange={(event) => setRememberChoice(event.target.checked)}
              />
              <span>Do not ask again — fetch PDFs whenever I open a paper</span>
            </label>
          )}
        </div>
      )}
      {!loading && error && (
        <div className="card empty-state">
          <h2>Cannot open this source</h2>
          <p>{error}</p>
          {loadButton}
        </div>
      )}
      {!loading && !error && !pdfUrl && !pendingDownload && !downloading && (
        <div className="card empty-state">
          <h2>Nothing to show</h2>
          <p>No PDF was provided for this locus.</p>
          {loadButton}
        </div>
      )}
      {/* Annotations belong to the paper, not to the PDF, so they survive a
          source that will not open — but they were only ever rendered as an
          overlay on the document, which made them look lost. List them here so
          the work is still reachable when the PDF is not. */}
      {!loading && !pdfUrl && annotations.length > 0 && (
        <AnnotationSidebar
          annotations={annotations}
          quotationTypes={quotationTypes}
          paperTitle={title ?? "Paper"}
          selectedId={null}
          onSelect={() => {}}
        />
      )}
      {!loading && pdfUrl && (
        <div className={`reader-main${aside ? " reader-main--split" : ""}`}>
          <PdfReader
            key={pdfUrl}
            url={isStoredPdfUrl(pdfUrl) ? pdfUrl : proxiedPdfUrl(pdfUrl)}
            originalUrl={pdfUrl}
            locus={locus}
            page={page}
            annotations={annotations}
            contentHash={contentHash}
            paperTitle={title ?? "Paper"}
            quotationTypes={quotationTypes}
            paperId={paperId ?? undefined}
            onAnnotationsChange={(next) => {
              setAnnotations((prev) => (typeof next === "function" ? next(prev) : next));
            }}
            onActivity={(kind, message) => activityRef.current?.(kind, message)}
            onSourceFailure={handleSourceFailure}
          />
          {aside}
        </div>
      )}
      {!loading && pdfUrl && loadButton ? (
        <div className="paper-pdf-pane-tools">{loadButton}</div>
      ) : null}
    </div>
  );
}
