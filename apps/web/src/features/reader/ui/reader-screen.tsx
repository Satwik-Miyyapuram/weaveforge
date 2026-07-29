"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { decodeLocus, type PdfLocus } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoader } from "@/components/thesis-loader";
import { PdfReader } from "./pdf-reader-lazy";
import {
  sanitizePdfUrl,
  proxiedPdfUrl,
  looksLikePdfUrl,
} from "../application/sanitize-reader-url";
import { resolvePaperPdfSourceForReader } from "../application/resolve-paper-pdf-for-reader";
import { projectZoteroAnnotations } from "../application/project-zotero-annotations";
import { mergeReaderAnnotations } from "../application/merge-reader-annotations";
import { parseReaderSplitPane } from "../application/reader-split";
import {
  appendActivityLog,
  collectAnnotationImageRegions,
  type ActivityLogEntry,
} from "../application/batch-annotation-ops";
import { ActivityCenter, ReaderSplitPanel } from "./reader-loop-panels";
import type { ZoteroAnnotation } from "@/features/papers/domain/zotero";

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
  const [pdfUrl, setPdfUrl] = useState<string | null>(paperId ? null : pdfFromParam);
  const [pdfRevokeUrl, setPdfRevokeUrl] = useState<string | null>(null);
  const [contentHash, setContentHash] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<import("@thesis/core").ReaderAnnotation[]>([]);
  const [quotationTypes, setQuotationTypes] = useState<Map<string, import("@thesis/core").QuotationType>>(
    new Map(),
  );
  const [loading, setLoading] = useState(Boolean(paperId));
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  const [splitTitle, setSplitTitle] = useState("Untitled");
  const [splitBody, setSplitBody] = useState("");
  const [splitHref, setSplitHref] = useState("/report");

  useEffect(() => {
    setError(null);
    setTitle(null);
    if (!paperId) {
      if (pdfFromParam) {
        setPdfUrl(pdfFromParam);
        setLoading(false);
        return;
      }
      setPdfUrl(null);
      setLoading(false);
      if (pdfParam) {
        setError("That PDF link is not allowed — only https PDF URLs can be opened.");
      }
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
        const resolution = await resolvePaperPdfSourceForReader({
          id: paper.id,
          url: paper.url,
          arxivId: paper.arxivId,
          doi: paper.doi,
          pdfPath: paper.pdfPath,
          metadata: paper.metadata,
        });
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
        let local: import("@thesis/core").ReaderAnnotation[] = [];
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
        if (resolution.ok) {
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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (revokeOnCancel) URL.revokeObjectURL(revokeOnCancel);
    };
  }, [paperId, pdfFromParam, pdfParam]);

  useEffect(() => {
    return () => {
      if (pdfRevokeUrl) URL.revokeObjectURL(pdfRevokeUrl);
    };
  }, [pdfRevokeUrl]);

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

  function logActivity(kind: string, message: string) {
    setActivity((prev) => appendActivityLog(prev, { kind, message }));
  }

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
      <div className="screen-header">
        <div>
          <p className="eyebrow">Source</p>
          <h1>{title ?? "Reader"}</h1>
          <p className="muted">
            In-app PDF reader — fit width by default; zoom, rotate, and jump pages from the toolbar.
          </p>
        </div>
        <div className="reader-screen-actions">
          {paperId && (
            <Link className="secondary-btn" href={`/papers?paper=${encodeURIComponent(paperId)}`}>
              Back to paper
            </Link>
          )}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setShowActivity((v) => !v)}>
            {showActivity ? "Hide activity" : "Activity"}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={runBatchExtractImages}>
            Batch: list images
          </button>
        </div>
      </div>
      {showActivity && (
        <ActivityCenter entries={activity} onClear={() => setActivity([])} />
      )}
      {loading && <ScreenLoader status="Resolving source…" />}
      {!loading && error && (
        <div className="card empty-state">
          <h2>Cannot open this source</h2>
          <p>{error}</p>
        </div>
      )}
      {!loading && !error && !pdfUrl && (
        <div className="card empty-state">
          <h2>Nothing to show</h2>
          <p>No PDF was provided for this locus.</p>
        </div>
      )}
      {!loading && pdfUrl && (
        <div className={`reader-main${pane ? " reader-main--split" : ""}`}>
          <PdfReader
            key={pdfUrl}
            url={pdfUrl.startsWith("blob:") ? pdfUrl : proxiedPdfUrl(pdfUrl)}
            originalUrl={pdfUrl}
            locus={locus ?? undefined}
            page={page}
            annotations={annotations}
            contentHash={contentHash}
            paperTitle={title ?? "Paper"}
            quotationTypes={quotationTypes}
            paperId={paperId ?? undefined}
            onAnnotationsChange={(next) => {
              setAnnotations((prev) => (typeof next === "function" ? next(prev) : next));
            }}
            onActivity={(kind, message) => logActivity(kind, message)}
          />
          {pane && (
            <ReaderSplitPanel
              kind={pane}
              title={splitTitle}
              bodyPreview={splitBody.slice(0, 4000)}
              href={splitHref}
              onClose={closeSplit}
            />
          )}
        </div>
      )}
    </section>
  );
}
