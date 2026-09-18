"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageTextItem, ParsedReference, ReaderOutlineItem, ReadingList } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import {
  buildReferenceIndex,
  type MentionHit,
  type ReaderReferenceIndex,
} from "../../application/reader-references";
import { locateMention, type PdfRect } from "../../application/reference-locate";
import type { ResolvedReference } from "../../application/reference-lookup";
import type { AnchorBox } from "../reference-popover-layer";

const LINK_CITATIONS_KEY = "weaveforge.reader.linkCitations";

function readLinkCitations(): boolean {
  try {
    return window.localStorage.getItem(LINK_CITATIONS_KEY) !== "off";
  } catch {
    return true;
  }
}

function overlaps(a: PdfRect, b: PdfRect): boolean {
  const [ax0, ay0, ax1, ay1] = [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])];
  const [bx0, by0, bx1, by1] = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}

export interface OpenMention {
  hit: MentionHit;
  entry: ParsedReference;
  anchor: AnchorBox | null;
}

export interface UseReaderReferencesInput {
  pageItems: ReadonlyMap<number, readonly PageTextItem[]>;
  linkRects: ReadonlyMap<number, readonly PdfRect[]>;
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
 * the popover's actions. Mentions that sit on one of the PDF's own `/Link`
 * annotations are dropped — the document's link wins over our guess.
 */
export function useReaderReferences(input: UseReaderReferencesInput) {
  const { pageItems, linkRects, outline, contentHash, paperId, setPage, onFigureTarget } = input;
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { setEnabled(readLinkCitations()); }, []);
  const toggle = useCallback(() => {
    setEnabled((on) => {
      try { window.localStorage.setItem(LINK_CITATIONS_KEY, on ? "off" : "on"); } catch { /* private mode */ }
      return !on;
    });
  }, []);

  const index = useMemo<ReaderReferenceIndex>(() => {
    const pages = [...pageItems].map(([pageNumber, items]) => ({ pageNumber, items }));
    const built = buildReferenceIndex(pages, outline);
    if (!linkRects.size) return built;
    const mentionsByPage = new Map<number, MentionHit[]>();
    for (const [pageNumber, hits] of built.mentionsByPage) {
      const links = linkRects.get(pageNumber);
      const items = pageItems.get(pageNumber) ?? [];
      const kept = links?.length
        ? hits.filter((hit) => {
          const { bounds } = locateMention(items, hit.start, hit.end);
          return !bounds || !links.some((link) => overlaps(link, bounds));
        })
        : hits;
      if (kept.length) mentionsByPage.set(pageNumber, kept);
    }
    return { ...built, mentionsByPage };
  }, [pageItems, linkRects, outline]);
  const documentKey = index.fingerprint || contentHash;

  const [open, setOpen] = useState<OpenMention | null>(null);
  const [resolutions, setResolutions] = useState<Map<number, ResolvedReference>>(() => new Map());
  const [lists, setLists] = useState<ReadingList[] | null>(null);
  const [linked, setLinked] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const inflight = useRef(new Set<number>());

  useEffect(() => {
    setResolutions(new Map());
    setOpen(null);
    inflight.current.clear();
  }, [documentKey]);

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
    setOpen({ hit, entry, anchor });
    const current = resolutions.get(entry.index);
    if (!current || current.status === "pending") resolve(entry);
  }, [index, resolutions, resolve, setPage, onFigureTarget]);

  const close = useCallback(() => { setOpen(null); setNotice(null); }, []);

  /** Resolve every entry the sidebar shows, once, in bibliography order. */
  const resolveAll = useCallback(() => {
    for (const entry of index.references) {
      if (!resolutions.has(entry.index)) resolve(entry);
    }
  }, [index, resolutions, resolve]);

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
    addToList: (entry: ParsedReference, listId: string) =>
      facade().actions.addToList(entry, listId).then((paper) => { markInLibrary(entry, paper); setNotice("Added to list"); }).catch(fail),
    loadLists: () => facade().readingLists().then(setLists).catch(fail),
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
    jumpToEntry: (entry: ParsedReference) => { setPage(entry.page); setOpen(null); },
  }), [markInLibrary, paperId, setPage]);

  return {
    enabled,
    toggle,
    index,
    open,
    openMention,
    close,
    resolutions,
    resolveAll,
    lists,
    linked,
    notice,
    actions,
  };
}
