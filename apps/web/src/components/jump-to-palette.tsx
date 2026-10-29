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
import { Modal } from "@/components/modal";
import { loadCiteLinkCatalog, type CiteCompletion } from "@/lib/hooks/use-cite-links";
import { getContainer } from "@/bootstrap";
import { useHybridSearchIndex } from "@/lib/hooks/use-search-index";
import {
  pinRecentTargets,
  readRecentTargets,
  rememberRecentTarget,
  type RecentTargetKind,
} from "@/lib/recent-targets";
import { readStoredJson, writeStoredJson } from "@/lib/safe-storage";
import { createNoteFromQuery } from "@/lib/create-note-from-query";
import { FormError } from "@/components/form-error";
import { JumpToCreateRow } from "@/components/jump-to-create-row";
import { useModuleRegistry } from "@/lib/hooks/use-nav-groups";
import { useTheme } from "@/lib/hooks/use-theme";
import { isMacPlatform } from "@/lib/shortcut-label";
import { groupPaletteRows, matchingPages, paletteKeys, type PaletteGroup } from "@/lib/palette-groups";
import { showNewProject, useProject } from "@/features/projects";
import { Chip, RowButton } from "./controls";
import { CloseButton } from "./button";

/** Kinds recorded as recent targets when opened. */
const RECENT_KINDS = ["paper", "note", "section"] as const satisfies readonly RecentTargetKind[];

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

/** One palette row: a search hit, a page or an action, under its heading. */
interface Entry {
  group: PaletteGroup;
  key: string;
  label: string;
  meta?: string;
  excerpt?: SearchExcerpt;
  run: () => void;
}

const HIT_GROUP: Record<JumpItem["kind"], PaletteGroup> = {
  paper: "Papers",
  note: "Notes",
  section: "Report sections",
  pdf: "In papers",
  annotation: "In papers",
};

const HISTORY_KEY = "thesis.search.history";

function readHistory(): string[] {
  return normalizeSearchHistory(readStoredJson<unknown>(HISTORY_KEY, []));
}

/** Storage disabled or full: history is a convenience, not state. */
function writeHistory(history: readonly string[]): void {
  writeStoredJson(HISTORY_KEY, history);
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
 * Ctrl/Cmd+K jump palette across papers, notes, report sections, pages and a
 * few actions, under group headings (DA-99).
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
  const [createError, setCreateError] = useState<string | null>(null);
  const registry = useModuleRegistry();
  const { setProject } = useProject();
  const theme = useTheme();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMacPlatform()), []);
  const saveHistory = useCallback((next: string[]) => {
    setHistory(next);
    writeHistory(next);
  }, []);

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
    setItems(pinRecentTargets(all, readRecentTargets(projectId)));
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setCreateError(null);
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

  /** Pages the nav reaches, plus Settings, which lives in the account menu. */
  const pages = useMemo(() => {
    const all = [registry.homeNavItem, ...registry.navItems, { key: "settings", label: "Settings", path: "/settings" }];
    return all.filter((page, index) => all.findIndex((other) => other.path === page.path) === index);
  }, [registry]);

  const entries = useMemo(() => {
    const leave = (then: () => void) => () => {
      setOpen(false);
      then();
    };
    const actions = [
      { key: "new-project", label: "New project", run: leave(() => showNewProject(setProject)) },
      {
        key: "theme",
        label: theme.dark ? "Switch to light theme" : "Switch to dark theme",
        run: leave(theme.toggle),
      },
    ];
    const rows: Entry[] = [
      ...matchingPages(pages, query).map((page) => ({
        group: "Pages" as const,
        key: `page:${page.path}`,
        label: page.label,
        run: leave(() => router.push(page.path)),
      })),
      ...filtered.map((c) => ({
        group: c.recent ? ("Recent" as const) : HIT_GROUP[c.kind],
        key: `${c.kind}-${c.id}`,
        label: c.label,
        meta: c.detail,
        excerpt: c.excerpt,
        run: () => go(c),
      })),
      ...matchingPages(actions, query).map((action) => ({ ...action, group: "Actions" as const })),
    ];
    return groupPaletteRows(rows);
    // `go` reads the same state as these dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, query, filtered, theme.dark, theme.toggle, setProject, router]);
  const flat = useMemo(() => entries.flatMap((group) => group.rows), [entries]);

  function go(item: JumpItem) {
    saveHistory(rememberSearchQuery(history, query));
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
    setCreateError(null);
    const result = await createNoteFromQuery(query, (input) => getContainer().vault.manageVaultPage.add(input));
    if (!result) return;
    if (!result.ok) {
      // The palette stays open with the query, so the user can retry.
      setCreateError(result.error);
      return;
    }
    const { page } = result;
    saveHistory(rememberSearchQuery(history, query.trim()));
    setOpen(false);
    router.push(`/notes?page=${encodeURIComponent(page.id)}`);
  }, [query, history, router, saveHistory]);

  if (!open) return null;

  return (
    <Modal
      variant="palette"
      title="Jump to"
      onClose={() => setOpen(false)}
      className="jump-to-dialog"
      onKeyDown={(e) => {
        // Ctrl+J/K and Ctrl+N/P alongside the arrows, so hands stay on the
        // home row. Ctrl is required: plain j/k must still type.
        const vimDown = e.ctrlKey && (e.key === "j" || e.key === "n");
        const vimUp = e.ctrlKey && (e.key === "k" || e.key === "p");
        if (e.key === "ArrowDown" || vimDown) {
          e.preventDefault();
          setActive((i) => Math.min(i + 1, flat.length - 1));
        } else if (e.key === "ArrowUp" || vimUp) {
          e.preventDefault();
          setActive((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && flat[active]) {
          e.preventDefault();
          flat[active]!.run();
        }
      }}
    >
      <input
        autoFocus
        placeholder="Jump to paper, note, or section…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCreateError(null);
          setActive(0);
        }}
        aria-label="Search"
      />
      {!query.trim() && history.length > 0 && (
        <ul className="jump-to-history" aria-label="Recent searches">
          {history.slice(0, 6).map((entry) => (
            <li key={entry}>
              <Chip onClick={() => setQuery(entry)}>{entry}</Chip>
              {/* A search you regret is a search you should be able to drop,
                  without clearing the five useful ones next to it. */}
              <CloseButton
                size="sm"
                label={`Remove “${entry}” from recent searches`}
                onClick={() => saveHistory(forgetSearchQuery(history, entry))}
              />
            </li>
          ))}
        </ul>
      )}
      <ul className="jump-to-list" role="listbox">
        {entries.map((group) => (
          <li key={group.label} role="presentation">
            <div className="jump-to-group" role="presentation">
              {group.label}
            </div>
            <ul role="group" aria-label={group.label}>
              {group.rows.map((c) => {
                const i = flat.indexOf(c);
                return (
                <li key={c.key} role="option" aria-selected={i === active}>
                  <RowButton onClick={c.run}>
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
                    {c.meta && <div className="jump-to-meta">{c.meta}</div>}
                  </RowButton>
                </li>
                );
              })}
            </ul>
          </li>
        ))}
        {filtered.length === 0 && <JumpToCreateRow query={query} onCreate={() => void createFromQuery()} />}
      </ul>
      {createError ? <FormError reportable={false}>{createError}</FormError> : null}
      <p className="muted jump-to-meta jump-to-keys">
        {paletteKeys(mac).map((hint) => (
          <span key={hint.label}>
            {hint.keys.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}{" "}
            {hint.label}
          </span>
        ))}
      </p>
    </Modal>
  );
}
