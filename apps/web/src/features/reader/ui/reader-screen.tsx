"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { decodeLocus, type PdfLocus, type ReaderAnnotation } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { PaperPdfPane } from "./paper-pdf-pane";
import { sanitizePdfUrl, looksLikePdfUrl } from "../application/sanitize-reader-url";
import { parseReaderSplitPane } from "../application/reader-split";
import {
  appendActivityLog,
  collectAnnotationImageRegions,
  type ActivityLogEntry,
} from "../application/batch-annotation-ops";
import { ActivityCenter, ReaderSplitPanel } from "./reader-loop-panels";

/** Reader route: renders a PDF via the source ladder and jumps to an optional locus. */
export function ReaderScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const paperId = params.get("paper");
  const pdfParam = params.get("pdf");
  const pageParam = params.get("page");
  const locusRaw = params.get("locus");
  const pane = parseReaderSplitPane(params.get("pane"));
  const sectionId = params.get("section");
  const noteId = params.get("note");
  const locus: PdfLocus | null = useMemo(() => decodeLocus(locusRaw), [locusRaw]);
  const page = useMemo(() => {
    const n = pageParam ? Number(pageParam) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }, [pageParam]);

  const pdfFromParam = useMemo(() => {
    const sanitized = sanitizePdfUrl(pdfParam);
    if (!sanitized) return null;
    return looksLikePdfUrl(sanitized) ? sanitized : null;
  }, [pdfParam]);
  const [title, setTitle] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  const [splitTitle, setSplitTitle] = useState("Untitled");
  const [splitBody, setSplitBody] = useState("");
  const [splitHref, setSplitHref] = useState("/report");
  // A `?pdf=` that is not an https PDF is refused, not opened.
  const badPdfParam = !paperId && Boolean(pdfParam) && !pdfFromParam;

  useEffect(() => {
    if (!pane) return;
    let cancelled = false;
    void (async () => {
      try {
        if (pane === "report") {
          if (!sectionId) {
            if (!cancelled) {
              setSplitTitle("Pick a report section");
              setSplitBody("Open a section from the report screen, or add ?section=<id> to the reader URL.");
              setSplitHref("/report");
            }
            return;
          }
          const section = await getContainer().report.getSection(sectionId);
          if (cancelled) return;
          if (!section) {
            setSplitTitle("Section not found");
            setSplitBody("");
            setSplitHref("/report");
            return;
          }
          setSplitTitle(section.title || "Untitled section");
          setSplitBody(section.notes ?? "");
          setSplitHref(`/report?section=${encodeURIComponent(section.id)}`);
          return;
        }
        if (pane === "vault") {
          if (!noteId) {
            if (!cancelled) {
              setSplitTitle("Pick a vault note");
              setSplitBody("Open a note from the vault, or add ?note=<id> to the reader URL.");
              setSplitHref("/vault");
            }
            return;
          }
          const page = await getContainer().vault.getPage(noteId);
          if (cancelled) return;
          if (!page) {
            setSplitTitle("Note not found");
            setSplitBody("");
            setSplitHref("/vault");
            return;
          }
          setSplitTitle(page.title || "Untitled note");
          setSplitBody(page.body ?? "");
          setSplitHref(`/vault?page=${encodeURIComponent(page.id)}`);
        }
      } catch {
        if (!cancelled) {
          setSplitTitle("Unavailable");
          setSplitBody("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pane, sectionId, noteId]);

  const logActivity = useCallback((kind: string, message: string) => {
    setActivity((prev) => appendActivityLog(prev, { kind, message }));
  }, []);

  function closeSplit() {
    const next = new URLSearchParams(params.toString());
    next.delete("pane");
    next.delete("section");
    next.delete("note");
    router.replace(`/reader?${next.toString()}`);
  }

  function runBatchExtractImages() {
    const regions = collectAnnotationImageRegions(annotations);
    logActivity("batch", `Listed ${regions.length} image region(s) for extract`);
    setShowActivity(true);
  }

  return (
    <section className={`screen reader-screen${pane ? " reader-screen--split" : ""}`}>
      {/* One bar, the mock's: back, the paper's title, and the two batch tools.
          The page count, zoom and find sit in the reader's own bar below. */}
      <div className="reader-screen-bar">
        {paperId && (
          <Link
            className="btn-secondary btn-sm reader-screen-back"
            href={`/papers?paper=${encodeURIComponent(paperId)}`}
            aria-label="Back to paper"
            title="Back to paper"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
        )}
        <h1 className="reader-screen-title">{title ?? "Reader"}</h1>
        <div className="reader-screen-actions">
          <button
            type="button"
            className="btn-ghost btn-sm"
            aria-pressed={showActivity}
            onClick={() => setShowActivity((v) => !v)}
          >
            Activity
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={runBatchExtractImages}>
            List images
          </button>
        </div>
      </div>
      {showActivity && (
        <ActivityCenter entries={activity} onClear={() => setActivity([])} />
      )}
      {badPdfParam ? (
        <div className="card empty-state">
          <h2>Cannot open this source</h2>
          <p>That PDF link is not allowed — only https PDF URLs can be opened.</p>
        </div>
      ) : (
        <PaperPdfPane
          paperId={paperId}
          pdfUrl={pdfFromParam}
          locus={locus ?? undefined}
          page={page}
          onActivity={logActivity}
          onTitle={setTitle}
          onAnnotations={setAnnotations}
          inkRail={params.get("pen") === "1"}
          aside={
            pane ? (
              <ReaderSplitPanel
                kind={pane}
                title={splitTitle}
                bodyPreview={splitBody.slice(0, 4000)}
                href={splitHref}
                onClose={closeSplit}
              />
            ) : undefined
          }
        />
      )}
    </section>
  );
}
