"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  excerptSegments,
  forgetSearchQuery,
  normalizeSearchHistory,
  rememberSearchQuery,
  type SearchExcerpt,
  type SearchHit,
} from "@weaveforge/core";
import { useRouter } from "next/navigation";
import { loadCiteLinkCatalog, type CiteCompletion } from "@/lib/hooks/use-cite-links";
import { getContainer } from "@/bootstrap";
import { useHybridSearchIndex } from "@/lib/hooks/use-search-index";
import {
  readRecentTargets,
  rememberRecentTarget,
  type RecentTargetKind,
} from "@/lib/recent-targets";

/** Kinds recorded as recent targets when opened. */
const RECENT_KINDS = ["paper", "note", "section"] as const satisfies readonly RecentTargetKind[];

/**
 * Kinds the palette searches. PDF pages are included but are not recent-target
 * kinds — they open the reader at a page rather than an entity screen.
 */
/**
 * Kinds the palette shows. PDF pages and highlights are locations inside a
 * paper rather than entities of their own, which is why they are listed here
 * but never recorded as recent targets.
 */
const PALETTE_KINDS = [...RECENT_KINDS, "pdf", "annotation"] as const;

/**
 * Hits that point into a document rather than at one.
 *
 * A type predicate rather than a `Set.has` so what remains narrows to a
 * `RecentTargetKind` — the recent-targets list only accepts entity kinds, and
 * the compiler should be the thing enforcing that.
 */
function isInDocument(kind: JumpItem["kind"]): kind is "pdf" | "annotation" {
  return kind === "pdf" || kind === "annotation";
}

type JumpItem = CiteCompletion & {
  id: string;
  kind: RecentTargetKind | "pdf" | "annotation";
  href: string;
  recent?: boolean;
  excerpt?: SearchExcerpt;
};

const HISTORY_KEY = "thesis.search.history";

function readHistory(): string[] {
  try {
    return normalizeSearchHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function writeHistory(history: readonly string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage disabled or full; history is a convenience, not state */
  }
}

/**
 * Event the nav's search button fires.
 *
 * A DOM event rather than shared state or a context: the button lives in the
 * navigation and the palette lives in the shell's main region, two unrelated
 * trees, and threading a "please open" callback between them would put plumbing
 * in every component along the way for one interaction.
 */
const OPEN_SEARCH_EVENT = "weaveforge:open-search";

/** Ask the palette to open, from anywhere. */
export function openSearchPalette(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

/**
 * Ctrl/Cmd+K jump palette across papers, notes, and report sections.
 */
export function JumpToPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<JumpItem[]>([]);
  const [active, setActive] = useState(0);
  // Warmed on open, not on mount: the palette is in the shell of every screen.
  //
  // The hybrid variant, so a query can reach the semantic arm when the reader has
  // turned it on. `useHybridSearchIndex` returns the plain keyword function for
  // the per-keystroke path *and* an async one that fuses in the encoder's nearest
  // passages; `searchHybrid` degrades to the keyword ranking on its own when no
  // encoder is attached, so nothing changes for anyone who has not opted in.
  const { search: searchIndex, searchHybrid, ready: indexReady } = useHybridSearchIndex(open);
  const [history, setHistory] = useState<string[]>([]);

  const reload = useCallback(async () => {
    const catalog = await loadCiteLinkCatalog();
    const completionByTitle = new Map(catalog.completions.map((item) => [item.title, item]));
    const all: JumpItem[] = [
      ...catalog.papers.map((item) => ({
        ...(completionByTitle.get(item.title) ?? { title: item.title, label: item.title }),
        id: item.id,
        kind: "paper" as const,
        href: `/papers?paper=${encodeURIComponent(item.id)}`,
      })),
      ...catalog.notes.map((item) => ({
        title: item.title,
        label: item.title,
        detail: "note",
        id: item.id,
        kind: "note" as const,
        href: `/notes?page=${encodeURIComponent(item.id)}`,
      })),
      ...catalog.sections.map((item) => ({
        title: item.title,
        label: item.title,
        detail: "section",
        id: item.id,
        kind: "section" as const,
        href: `/report?section=${encodeURIComponent(item.id)}`,
      })),
    ];
    const projectId = getContainer().projects.context.projectId;
    const recentKeys = new Set(
      readRecentTargets(projectId).map((item) => `${item.kind}:${item.id}`),
    );
    const recent = readRecentTargets(projectId).flatMap((target) => {
      const match = all.find(
        (item) => item.id === target.id && item.kind === target.kind,
      );
      return match ? [{ ...match, recent: true }] : [];
    });
    setItems([...recent, ...all.filter((item) => !recentKeys.has(`${item.kind}:${item.id}`))]);
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActive(0);
    setHistory(readHistory());
    void reload();
  }, [reload]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, openPalette);
    };
  }, [openPalette]);

  /**
   * Ranked hits as palette rows, shared by both search paths.
   *
   * Extracted because the keyword pass and the hybrid pass produce the same
   * `SearchHit` shape and must render identically — a semantic hit that looked
   * different from a keyword hit would tell the reader which arm found it, which
   * is not a distinction they asked for.
   */
  const rowsFromHits = useCallback(
    (hits: readonly SearchHit[]): JumpItem[] => {
      if (hits.length === 0) return [];
      const byKey = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]));
      return hits.map((hit) => {
        const kind = hit.kind as JumpItem["kind"];
        const inDocument = isInDocument(kind);
        // An in-document hit never reuses the paper's catalog entry: it has to
        // keep its own page-specific href, or every highlight would navigate to
        // the top of the paper.
        const known = inDocument ? undefined : byKey.get(`${kind}:${hit.entityId}`);
        const page = (hit.page ?? 0) + 1;
        const base = known ?? {
          title: hit.title,
          label: hit.title,
          // "PDF · page 12" reads better than a bare kind for a page hit.
          detail:
            kind === "pdf"
              ? `PDF · page ${page}`
              : kind === "annotation"
                ? `highlight · page ${page}`
                : kind,
          // The hit's own document id for in-document rows. The old
          // `${entityId}#${kind}${page}` was shared by every highlight on the
          // same page of the same paper, so React got duplicate keys and drew
          // one highlight five times in place of five different ones.
          id: inDocument ? hit.id : hit.entityId,
          kind,
          href: hit.href,
        };
        return { ...base, excerpt: hit.excerpt };
      }).filter((row, index, rows) =>
        // One row per key: two hits resolving to the same entity (a note found
        // by its title and its body) would otherwise render twice.
        rows.findIndex((other) => other.kind === row.kind && other.id === row.id) === index,
      );
    },
    [items],
  );

  /**
   * The ranked result for the current query, keyword first and semantic once it
   * answers.
   *
   * The keyword pass is synchronous, so the palette never waits to show something.
   * The hybrid pass runs after it and replaces the rows when it resolves — which
   * is what makes turning semantic search on a change of *results* rather than a
   * change of nothing. Before this, `enableSemanticSearch` built and stored the
   * whole index and every screen still queried the keyword arm alone; the only
   * caller of `searchHybrid` was its own test.
   *
   * Two guards, because a query is typed one character at a time. A stale answer
   * must not overwrite a newer one (`settled` records the query it answered), and
   * it must not land after the palette closes.
   */
  const [semanticRows, setSemanticRows] = useState<JumpItem[] | null>(null);
  useEffect(() => {
    const q = query.trim();
    setSemanticRows(null);
    if (!q || !indexReady) return;
    let live = true;
    void searchHybrid(q, { limit: 30, kinds: PALETTE_KINDS, excerpts: true })
      .then((hits) => {
        if (!live) return;
        // An empty answer is kept too: the fused ranking drops keyword hits that
        // matched only a word or two of the question, so nothing is its verdict
        // that nothing is about it. Discarding it left the raw keyword rows up,
        // and "how cooking pasta works" listed papers that share "works".
        setSemanticRows(rowsFromHits(hits));
      })
      .catch(() => {
        // The keyword rows are already on screen; nothing to do.
      });
    return () => {
      live = false;
    };
  }, [query, indexReady, searchHybrid, rowsFromHits]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 30);

    // Index not built yet, or genuinely no ranked match: the substring pass
    // still answers, so a title typed out is never hidden.
    const lower = q.toLowerCase();
    const bySubstring = () =>
      items
        .filter((c) => c.label.toLowerCase().includes(lower) || c.title.toLowerCase().includes(lower))
        .slice(0, 30);

    // The hybrid answer wins when it has arrived: the keyword ranking, stricter
    // about partial matches, fused with the encoder's nearest passages.
    if (semanticRows) return semanticRows.length > 0 ? semanticRows : bySubstring();

    const hits = searchIndex(q, { limit: 30, kinds: PALETTE_KINDS, excerpts: true });
    const ranked = rowsFromHits(hits);
    if (ranked.length > 0) return ranked;
    return bySubstring();
  }, [items, query, searchIndex, rowsFromHits, semanticRows]);

  function go(item: JumpItem) {
    const next = rememberSearchQuery(history, query);
    setHistory(next);
    writeHistory(next);
    // Only entity screens are recent targets; a PDF page or a highlight is a
    // location inside one, and recording it would push the paper itself out of
    // the list.
    if (!isInDocument(item.kind)) {
      rememberRecentTarget(getContainer().projects.context.projectId, {
        kind: item.kind,
        id: item.id,
        title: item.title,
        href: item.href,
      });
    }
    setOpen(false);
    router.push(item.href);
  }

  /** Turn a fruitless search into the note it was looking for. */
  const createFromQuery = useCallback(async () => {
    const title = query.trim();
    if (!title) return;
    const page = await getContainer().vault.manageVaultPage.add({ title });
    const next = rememberSearchQuery(history, title);
    setHistory(next);
    writeHistory(next);
    setOpen(false);
    router.push(`/notes?page=${encodeURIComponent(page.id)}`);
  }, [query, history, router]);

  if (!open) return null;

  return (
    <div
      className="jump-to-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="jump-to-dialog"
        role="dialog"
        aria-label="Jump to"
        onKeyDown={(e) => {
          // Ctrl+J/K and Ctrl+N/P alongside the arrows, so hands stay on the
          // home row. Ctrl is required: plain j/k must still type.
          const vimDown = e.ctrlKey && (e.key === "j" || e.key === "n");
          const vimUp = e.ctrlKey && (e.key === "k" || e.key === "p");
          if (e.key === "ArrowDown" || vimDown) {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp" || vimUp) {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && filtered[active]) {
            e.preventDefault();
            go(filtered[active]!);
          }
        }}
      >
        <input
          autoFocus
          placeholder="Jump to paper, note, or section…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          aria-label="Search"
        />
        {!query.trim() && history.length > 0 && (
          <ul className="jump-to-history" aria-label="Recent searches">
            {history.slice(0, 6).map((entry) => (
              <li key={entry}>
                <button type="button" className="jump-to-chip" onClick={() => setQuery(entry)}>
                  {entry}
                </button>
                {/* A search you regret is a search you should be able to drop,
                    without clearing the five useful ones next to it. */}
                <button
                  type="button"
                  className="jump-to-chip-remove"
                  aria-label={`Remove “${entry}” from recent searches`}
                  onClick={() => {
                    const next = forgetSearchQuery(history, entry);
                    setHistory(next);
                    writeHistory(next);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="jump-to-list" role="listbox">
          {filtered.map((c, i) => (
            <li key={`${c.kind}-${c.id}`} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => go(c)}>
                <div>{c.label}</div>
                {c.excerpt && c.excerpt.text && (
                  <div className="jump-to-excerpt">
                    {excerptSegments(c.excerpt).map((segment, index) =>
                      segment.highlighted ? (
                        <mark key={index}>{segment.text}</mark>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      ),
                    )}
                  </div>
                )}
                {c.detail && (
                  <div className="jump-to-meta">{c.recent ? `recent · ${c.detail}` : c.detail}</div>
                )}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li>
              {/* A search that finds nothing is often a note that should exist. */}
              <button type="button" className="jump-to-create" onClick={() => void createFromQuery()}>
                Create note “{query.trim()}”
              </button>
            </li>
          )}
        </ul>
        <p className="muted jump-to-meta">Ctrl/Cmd+K · Ctrl+J/K to move · Esc to close</p>
      </div>
    </div>
  );
}
