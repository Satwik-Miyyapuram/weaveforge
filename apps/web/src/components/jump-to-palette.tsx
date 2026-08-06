"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  excerptSegments,
  forgetSearchQuery,
  normalizeSearchHistory,
  rememberSearchQuery,
  type SearchExcerpt,
} from "@thesis/core";
import { useRouter } from "next/navigation";
import { loadCiteLinkCatalog, type CiteCompletion } from "@/lib/use-cite-links";
import { getContainer } from "@/bootstrap";
import { useSearchIndex } from "@/lib/use-search-index";
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
export const OPEN_SEARCH_EVENT = "weaveforge:open-search";

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
  const searchIndex = useSearchIndex();
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

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 30);

    // Ranked search across every indexed field — body text, headings, tags,
    // aliases — not just the titles the catalog carries.
    //
    // Restricted to the kinds this palette can navigate to and record as a
    // recent target. The index covers experiments, milestones, and logbook
    // entries too; surfacing those needs `RecentTargetKind` widened first,
    // so it belongs with the rest of the search UX work rather than here.
    const hits = searchIndex(q, { limit: 30, kinds: PALETTE_KINDS, excerpts: true });
    if (hits.length > 0) {
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
          id: inDocument ? `${hit.entityId}#${kind}${hit.page ?? 0}` : hit.entityId,
          kind,
          href: hit.href,
        };
        return { ...base, excerpt: hit.excerpt };
      });
    }

    // Index not built yet, or genuinely no ranked match: the substring pass
    // still answers, so the palette never regresses to empty.
    const lower = q.toLowerCase();
    return items
      .filter((c) => c.label.toLowerCase().includes(lower) || c.title.toLowerCase().includes(lower))
      .slice(0, 30);
  }, [items, query, searchIndex]);

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
    getContainer().search.invalidate();
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
