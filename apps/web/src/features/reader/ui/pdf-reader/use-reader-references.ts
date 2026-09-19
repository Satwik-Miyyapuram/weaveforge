"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageTextItem, ParsedReference, PdfLink, ReaderOutlineItem } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import {
  type MentionHit,
  type ReaderReferenceIndex,
} from "../../application/reader-references";
import type { ResolvedReference } from "../../application/reference-lookup";
import type { AnchorBox } from "../reference-popover-layer";
import { useDocumentAnalyzer } from "./use-document-analyzer";

const LINK_CITATIONS_KEY = "weaveforge.reader.linkCitations";

function readLinkCitations(): boolean {
  try {
    return window.localStorage.getItem(LINK_CITATIONS_KEY) !== "off";
  } catch {
    return true;
  }
}

export interface OpenMention {
  hit: MentionHit;
  entry: ParsedReference;
  anchor: AnchorBox | null;
  /** How much the analyzer trusted this citation match (0–1). */
  confidence?: number;
}

export interface UseReaderReferencesInput {
  pageItems: ReadonlyMap<number, readonly PageTextItem[]>;
  pageLinks: ReadonlyMap<number, readonly PdfLink[]>;
  outline: readonly ReaderOutlineItem[];
  /** Falls back to this when the text layer yields no fingerprint. */
  contentHash: string;
  paperId?: string;
  setPage: (pageNumber: number) => void;
  /** Called with a figure target's page and caption offsets, for the flash. */
  onFigureTarget?: (target: NonNullable<MentionHit["target"]>) => void;
}

/**
 * Everything the reader needs to link citations: the index built from the
 * text layer, which mention is open, what each reference resolved to, and
 * the popover's actions. The document's own `/Link` annotations go into the
 * index: internal ones are citations, URL ones are the document's to keep.
 */
export function useReaderReferences(input: UseReaderReferencesInput) {
  const { pageItems, pageLinks, outline, contentHash, paperId, setPage, onFigureTarget } = input;
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { setEnabled(readLinkCitations()); }, []);
  const toggle = useCallback(() => {
    setEnabled((on) => {
      try { window.localStorage.setItem(LINK_CITATIONS_KEY, on ? "off" : "on"); } catch { /* private mode */ }
      return !on;
    });
  }, []);

  const referencePages = useMemo(
    () => [...pageItems].map(([pageNumber, items]) => ({ pageNumber, items, links: pageLinks.get(pageNumber) ?? [] })),
    [pageItems, pageLinks],
  );
  const { index, analysis, progress: analysisProgress, isAnalyzing } = useDocumentAnalyzer({
    pages: referencePages,
    outline,
    enabled,
  });

  const documentKey = index.fingerprint || contentHash;

  const [open, setOpen] = useState<OpenMention | null>(null);
  const [resolutions, setResolutions] = useState<Map<number, ResolvedReference>>(() => new Map());
  const [linked, setLinked] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const inflight = useRef(new Set<number>());
  const queueRef = useRef<ParsedReference[]>([]);
  const queueActiveRef = useRef(false);
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setResolutions(new Map());
    setOpen(null);
    inflight.current.clear();
    queueRef.current = [];
    queueActiveRef.current = false;
    if (queueTimerRef.current) {
      clearTimeout(queueTimerRef.current);
      queueTimerRef.current = null;
    }
  }, [documentKey]);

  useEffect(() => {
    return () => {
      if (queueTimerRef.current) {
        clearTimeout(queueTimerRef.current);
        queueTimerRef.current = null;
      }
    };
  }, []);

  const setResolution = useCallback((refIndex: number, value: ResolvedReference) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(refIndex, value);
      return next;
    });
  }, []);

  const resolve = useCallback((entry: ParsedReference) => {
    if (inflight.current.has(entry.index)) return;
    inflight.current.add(entry.index);
    setResolution(entry.index, { status: "pending" });
    getContainer().readerReferences.resolve(documentKey, entry)
      .then((value) => setResolution(entry.index, value))
      .catch(() => setResolution(entry.index, { status: "unresolved" }))
      .finally(() => inflight.current.delete(entry.index));
  }, [documentKey, setResolution]);

  const processQueue = useCallback(() => {
    if (!queueActiveRef.current) return;
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      if (resolutions.has(next.index) || inflight.current.has(next.index)) {
        continue;
      }
      inflight.current.add(next.index);
      setResolution(next.index, { status: "pending" });
      const startedAt = Date.now();
      getContainer().readerReferences.resolve(documentKey, next)
        .then((value) => setResolution(next.index, value))
        .catch(() => setResolution(next.index, { status: "unresolved" }))
        .finally(() => {
          inflight.current.delete(next.index);
          if (queueActiveRef.current && queueRef.current.length > 0) {
            const elapsed = Date.now() - startedAt;
            const waitTime = Math.max(100, 1000 - elapsed);
            queueTimerRef.current = setTimeout(() => {
              queueTimerRef.current = null;
              processQueue();
            }, waitTime);
          }
        });
      return;
    }
  }, [documentKey, resolutions, setResolution]);

  const startPrefetch = useCallback(() => {
    queueActiveRef.current = true;
    const toQueue = index.references.filter(
      (entry) => !resolutions.has(entry.index) && !inflight.current.has(entry.index) && !queueRef.current.some((q) => q.index === entry.index)
    );
    if (toQueue.length > 0) {
      queueRef.current.push(...toQueue);
      if (!queueTimerRef.current && inflight.current.size === 0) {
        processQueue();
      }
    }
  }, [index.references, resolutions, processQueue]);

  const stopPrefetch = useCallback(() => {
    queueActiveRef.current = false;
    queueRef.current = [];
    if (queueTimerRef.current) {
      clearTimeout(queueTimerRef.current);
      queueTimerRef.current = null;
    }
  }, []);

  const prefetchMention = useCallback((hit: MentionHit) => {
    if (hit.kind === "figure") return;
    const entry = hit.refIndexes.map((i) => index.byIndex.get(i)).find(Boolean);
    if (entry && !resolutions.has(entry.index) && !inflight.current.has(entry.index)) {
      resolve(entry);
    }
  }, [index.byIndex, resolutions, resolve]);

  const openMention = useCallback((hit: MentionHit, anchor: AnchorBox | null) => {
    if (hit.kind === "figure") {
      if (hit.target) {
        setPage(hit.target.page);
        onFigureTarget?.(hit.target);
      }
      return;
    }
    const entry = hit.refIndexes.map((i) => index.byIndex.get(i)).find(Boolean);
    if (!entry) return;
    setNotice(null);
    setOpen({ hit, entry, anchor, confidence: hit.confidence });
    const current = resolutions.get(entry.index);
    if (!current || current.status === "pending") resolve(entry);
  }, [index, resolutions, resolve, setPage, onFigureTarget]);

  const close = useCallback(() => { setOpen(null); setNotice(null); }, []);

  /** Lazy prefetch bibliography entries with rate limiting */
  const resolveAll = useCallback((enable = true) => {
    if (enable) {
      startPrefetch();
    } else {
      stopPrefetch();
    }
  }, [startPrefetch, stopPrefetch]);

  const facade = () => getContainer().readerReferences;
  const fail = (err: unknown) => setNotice(err instanceof Error ? err.message : String(err));

  const markInLibrary = useCallback((entry: ParsedReference, paper: Awaited<ReturnType<ReturnType<typeof facade>["actions"]["readLater"]>>) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      const current = prev.get(entry.index);
      next.set(entry.index, current?.status === "resolved"
        ? { ...current, inLibrary: paper }
        : { status: "resolved", metadata: { title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, doi: paper.doi }, inLibrary: paper, sourceId: "library" });
      return next;
    });
  }, []);

  const actions = useMemo(() => ({
    readLater: (entry: ParsedReference) =>
      facade().actions.readLater(entry).then((paper) => { markInLibrary(entry, paper); setNotice("Saved to read later"); }).catch(fail),
    addManually: (entry: ParsedReference) =>
      facade().actions.addManually(entry).then((paper) => { markInLibrary(entry, paper); setNotice("Added to library"); }).catch(fail),
    addToLibrary: (entry: ParsedReference) =>
      facade().actions.addToLibrary(entry).then((paper) => { markInLibrary(entry, paper); setNotice("Added to library"); }).catch(fail),
    linkPapers: (citedId: string) => {
      if (!paperId) return Promise.resolve();
      return facade().actions.linkPapers(paperId, citedId)
        .then(() => { setLinked((prev) => new Set(prev).add(citedId)); setNotice("Linked"); })
        .catch(fail);
    },
    cite: (resolution: ResolvedReference, entry: ParsedReference) => {
      const text = resolution.status === "resolved"
        ? [resolution.metadata.authors?.join(", "), resolution.metadata.year ? `(${resolution.metadata.year})` : "", resolution.metadata.title, resolution.metadata.venue, resolution.metadata.doi ? `https://doi.org/${resolution.metadata.doi}` : ""].filter(Boolean).join(". ").replace(/\.\./g, ".")
        : entry.raw;
      return navigator.clipboard?.writeText(text).then(() => setNotice("Citation copied")).catch(fail) ?? Promise.resolve();
    },
    jumpToEntry: (entry: ParsedReference) => {
      // The entry carries its first line's position; landing on the page
      // alone leaves the reader hunting through a two-column bibliography.
      // The target scroll is the only scroll: setting the page as well queues
      // a scroll to the page top that overrides it, and the page tracker
      // follows the scroll on its own.
      setOpen(null);
      if (onFigureTarget) onFigureTarget({ page: entry.page, x: entry.x, y: entry.y });
      else setPage(entry.page);
    },
  }), [markInLibrary, paperId, setPage, onFigureTarget]);

  return {
    enabled,
    toggle,
    index,
    /** The structured document analysis: sections, entries, citations, figures. */
    analysis,
    open,
    openMention,
    close,
    resolutions,
    resolveAll,
    startPrefetch,
    stopPrefetch,
    prefetchMention,
    linked,
    notice,
    actions,
    analysisProgress,
    isAnalyzing,
  };
}
