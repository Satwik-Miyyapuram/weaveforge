"use client";

import { useMemo, useState } from "react";
import {
  QUOTATION_TYPE_LABELS,
  type QuotationType,
  type ReaderAnnotation,
  type ReaderAnnotationType,
} from "@thesis/core";
import { formatQuoteCiteClipboard } from "@/features/papers/application/sync-annotation-excerpts";

interface AnnotationSidebarProps {
  annotations: ReaderAnnotation[];
  quotationTypes?: Map<string, QuotationType>;
  paperTitle: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AnnotationSidebar({
  annotations,
  quotationTypes,
  paperTitle,
  selectedId,
  onSelect,
}: AnnotationSidebarProps) {
  const [typeFilter, setTypeFilter] = useState<ReaderAnnotationType | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [pageFilter, setPageFilter] = useState("");

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const a of annotations) for (const t of a.tags) set.add(t);
    return [...set].sort();
  }, [annotations]);

  const filtered = annotations.filter((a) => {
    if (typeFilter && a.type !== typeFilter) return false;
    if (tagFilter && !a.tags.includes(tagFilter)) return false;
    if (pageFilter !== "") {
      const page = a.anchor.zoteroPosition?.pageIndex;
      if (page == null || String(page + 1) !== pageFilter) return false;
    }
    return true;
  });

  async function copyCite(a: ReaderAnnotation) {
    const quote = (a.text || a.comment).trim();
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(formatQuoteCiteClipboard(quote, paperTitle));
    } catch {
      /* clipboard may be unavailable */
    }
  }

  return (
    <aside className="pdf-reader-sidebar" aria-label="Annotations">
      <div className="pdf-reader-sidebar-filters">
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ReaderAnnotationType | "")}
        >
          <option value="">All types</option>
          <option value="highlight">Highlight</option>
          <option value="underline">Underline</option>
          <option value="note">Note</option>
          <option value="image">Image</option>
          <option value="ink">Ink</option>
          <option value="text">Text</option>
        </select>
        <select
          aria-label="Filter by tag"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          placeholder="Page"
          aria-label="Filter by page"
          value={pageFilter}
          onChange={(e) => setPageFilter(e.target.value)}
        />
      </div>
      <ul className="pdf-reader-sidebar-list">
        {filtered.map((a) => {
          const qType = a.zoteroKey ? quotationTypes?.get(a.zoteroKey) : undefined;
          return (
            <li key={a.id}>
              <button
                type="button"
                className={`pdf-reader-sidebar-item${selectedId === a.id ? " is-selected" : ""}`}
                onClick={() => onSelect(a.id)}
              >
                <span
                  className="pdf-reader-sidebar-swatch"
                  style={{ background: a.color }}
                  aria-hidden
                />
                <span className="pdf-reader-sidebar-meta">
                  <span className="muted">
                    {a.type}
                    {a.anchor.zoteroPosition
                      ? ` · p.${a.anchor.zoteroPosition.pageIndex + 1}`
                      : ""}
                    {qType ? ` · ${QUOTATION_TYPE_LABELS[qType]}` : ""}
                  </span>
                  {a.text && <span className="pdf-reader-sidebar-text">{a.text}</span>}
                  {a.comment && <span className="muted">{a.comment}</span>}
                </span>
              </button>
              {(a.text || a.comment) && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void copyCite(a)}
                >
                  Copy quote + cite
                </button>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="muted">No annotations match these filters.</li>
        )}
      </ul>
    </aside>
  );
}
