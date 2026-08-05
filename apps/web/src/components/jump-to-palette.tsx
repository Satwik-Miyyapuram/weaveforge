"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadCiteLinkCatalog, type CiteCompletion } from "@/lib/use-cite-links";
import { getContainer } from "@/bootstrap";
import { useSearchIndex } from "@/lib/use-search-index";
import {
  readRecentTargets,
  rememberRecentTarget,
  type RecentTargetKind,
} from "@/lib/recent-targets";

/** Kinds the palette can navigate to and store in recent targets. */
const PALETTE_KINDS = ["paper", "note", "section"] as const satisfies readonly RecentTargetKind[];

type JumpItem = CiteCompletion & {
  id: string;
  kind: RecentTargetKind;
  href: string;
  recent?: boolean;
};

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setQuery("");
        setActive(0);
        void reload();
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reload]);

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
    const hits = searchIndex(q, { limit: 30, kinds: PALETTE_KINDS });
    if (hits.length > 0) {
      const byKey = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]));
      return hits.map((hit) => {
        const kind = hit.kind as RecentTargetKind;
        return (
          byKey.get(`${kind}:${hit.entityId}`) ?? {
            title: hit.title,
            label: hit.title,
            detail: kind,
            id: hit.entityId,
            kind,
            href: hit.href,
          }
        );
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
    rememberRecentTarget(getContainer().projects.context.projectId, {
      kind: item.kind,
      id: item.id,
      title: item.title,
      href: item.href,
    });
    setOpen(false);
    router.push(item.href);
  }

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
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
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
        <ul className="jump-to-list" role="listbox">
          {filtered.map((c, i) => (
            <li key={`${c.detail}-${c.title}`} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => go(c)} aria-selected={i === active}>
                <div>{c.label}</div>
                {c.detail && (
                  <div className="jump-to-meta">{c.recent ? `recent · ${c.detail}` : c.detail}</div>
                )}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="muted">No matches</li>}
        </ul>
        <p className="muted jump-to-meta">Ctrl/Cmd+K · Esc to close</p>
      </div>
    </div>
  );
}
