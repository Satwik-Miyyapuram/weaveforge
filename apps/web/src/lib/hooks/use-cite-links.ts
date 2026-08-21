"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeTitleKey } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import type { WikilinkResolver } from "@/components/markdown/markdown";

export type CiteLinkEntry = { id: string; title: string };

/** One autocomplete option — `[[title]]` insert, or formatted cite when paper is set. */
export type CiteCompletion = {
  title: string;
  /** Shown in the completion list (e.g. Author (year) · Title). */
  label: string;
  detail?: string;
  /** Paper fields for non-wikilink citation formats (Phase C2). */
  paper?: {
    id: string;
    title: string;
    authors: readonly string[];
    year?: number;
    doi?: string;
    arxivId?: string;
    bibtex?: string;
    metadata?: Record<string, unknown>;
  };
};

export interface CiteLinkCatalog {
  titles: string[];
  completions: CiteCompletion[];
  notes: CiteLinkEntry[];
  papers: CiteLinkEntry[];
  sections: CiteLinkEntry[];
}

const EMPTY: CiteLinkCatalog = {
  titles: [],
  completions: [],
  notes: [],
  papers: [],
  sections: [],
};

function paperCiteLabel(
  paper: {
    id: string;
    title: string;
    authors: readonly string[];
    year?: number;
    doi?: string;
    arxivId?: string;
    bibtex?: string;
    metadata?: Record<string, unknown>;
  },
): CiteCompletion {
  const author =
    paper.authors.length === 0
      ? ""
      : paper.authors.length === 1
        ? paper.authors[0]!
        : `${paper.authors[0]!} et al.`;
  const yearBit = paper.year != null ? `(${paper.year})` : "";
  const head = [author, yearBit].filter(Boolean).join(" ");
  return {
    title: paper.title,
    label: head ? `${head} · ${paper.title}` : paper.title,
    detail: "paper",
    paper: {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      doi: paper.doi,
      arxivId: paper.arxivId,
      bibtex: paper.bibtex,
      metadata: paper.metadata,
    },
  };
}

/** Load note/paper/report titles for cite autocomplete and wikilink resolution. */
export async function loadCiteLinkCatalog(): Promise<CiteLinkCatalog> {
  const c = getContainer();
  const [papersData, vaultData, reportData] = await Promise.all([
    c.papers.loadScreenData().catch(() => null),
    c.vault.loadScreenData().catch(() => null),
    c.report.loadScreenData().catch(() => null),
  ]);
  const paperRows = papersData?.papers ?? [];
  const papers = paperRows.map((p) => ({ id: p.id, title: p.title }));
  const notes = (vaultData?.flat ?? []).map((n) => ({ id: n.id, title: n.title }));
  const sections = (reportData?.flat ?? []).map((s) => ({ id: s.id, title: s.title }));

  const completions: CiteCompletion[] = [];
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const p of paperRows) {
    const key = normalizeTitleKey(p.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(p.title);
    completions.push(paperCiteLabel(p));
  }
  for (const n of notes) {
    const key = normalizeTitleKey(n.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(n.title);
    completions.push({ title: n.title, label: n.title, detail: "note" });
  }
  for (const s of sections) {
    const key = normalizeTitleKey(s.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(s.title);
    completions.push({ title: s.title, label: s.title, detail: "section" });
  }

  return { titles, completions, notes, papers, sections };
}

/** Project-scoped cite targets for editors and markdown previews. */
export function useCiteLinkCatalog(): CiteLinkCatalog {
  const [catalog, setCatalog] = useState<CiteLinkCatalog>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    void loadCiteLinkCatalog().then((next) => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}

export function makeWikilinkResolver(
  notes: readonly CiteLinkEntry[],
  papers: readonly CiteLinkEntry[],
  sections: readonly CiteLinkEntry[] = [],
): WikilinkResolver {
  const noteMap = new Map(notes.map((n) => [normalizeTitleKey(n.title), n.id]));
  const paperMap = new Map(papers.map((p) => [normalizeTitleKey(p.title), p.id]));
  const sectionMap = new Map(sections.map((s) => [normalizeTitleKey(s.title), s.id]));
  return (target) => {
    const key = normalizeTitleKey(target);
    const noteId = noteMap.get(key);
    if (noteId) return { href: `/notes?page=${encodeURIComponent(noteId)}`, unresolved: false };
    const paperId = paperMap.get(key);
    if (paperId) return { href: `/papers?paper=${encodeURIComponent(paperId)}`, unresolved: false };
    const sectionId = sectionMap.get(key);
    if (sectionId) {
      return { href: `/report?section=${encodeURIComponent(sectionId)}`, unresolved: false };
    }
    return { href: "#", unresolved: true };
  };
}

/** Click handler for `a[data-wikilink]` anchors rendered by ShikiMarkdown. */
function useWikilinkClick(
  onCreateNote?: (title: string) => void,
): (event: React.MouseEvent<HTMLElement>) => void {
  const router = useRouter();
  return useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const anchor = (event.target as HTMLElement).closest("a[data-wikilink]");
      if (!anchor) return;
      event.preventDefault();
      const create = anchor.getAttribute("data-create");
      if (create != null) {
        onCreateNote?.(create);
        return;
      }
      const href = anchor.getAttribute("href");
      if (href && href !== "#") router.push(href);
    },
    [router, onCreateNote],
  );
}

/** Resolver + click handler bound to the live cite catalog. */
export function useWikilinkNavigation(onCreateNote?: (title: string) => void) {
  const catalog = useCiteLinkCatalog();
  const resolveWikilink = useMemo(
    () => makeWikilinkResolver(catalog.notes, catalog.papers, catalog.sections),
    [catalog.notes, catalog.papers, catalog.sections],
  );
  const onWikilinkClick = useWikilinkClick(onCreateNote);
  return { catalog, resolveWikilink, onWikilinkClick };
}
