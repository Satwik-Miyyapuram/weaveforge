"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  QUOTATION_TYPE_LABELS,
  type QuotationType,
  type ReaderAnnotation,
  type ReaderAnnotationType,
} from "@thesis/core";
import { formatQuoteCiteClipboard } from "@/features/papers/application/sync-annotation-excerpts";
import {
  annotationPinKey,
  READER_ANNOTATION_COLORS,
} from "../application/reader-annotation-helpers";
import type { AnnotationBacklinkTarget } from "../application/annotation-backlinks";
import { Select } from "@/components/select";

export interface ReportSectionOption {
  id: string;
  title: string;
}

interface AnnotationSidebarProps {
  annotations: ReaderAnnotation[];
  quotationTypes?: Map<string, QuotationType>;
  paperTitle: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Local edit affordances — only for origin === "local". */
  canEditLocal?: boolean;
  reportSections?: ReportSectionOption[];
  pinsByKey?: Map<string, string | null>;
  onUpdateLocal?: (
    id: string,
    patch: { comment?: string; tags?: string[]; color?: string },
  ) => Promise<void>;
  onRemoveLocal?: (id: string) => Promise<void>;
  onPinLocal?: (ann: ReaderAnnotation, sectionId: string | null) => Promise<void>;
  backlinks?: AnnotationBacklinkTarget[];
}

export function AnnotationSidebar({
  annotations,
  quotationTypes,
  paperTitle,
  selectedId,
  onSelect,
  canEditLocal = false,
  reportSections = [],
  pinsByKey,
  onUpdateLocal,
  onRemoveLocal,
  onPinLocal,
  backlinks = [],
}: AnnotationSidebarProps) {
  const [typeFilter, setTypeFilter] = useState<ReaderAnnotationType | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [pageFilter, setPageFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const a of annotations) for (const t of a.tags) set.add(t);
    return [...set].sort();
  }, [annotations]);

  const filtered = annotations.filter((a) => {
    if (typeFilter && a.type !== typeFilter) return false;
    if (tagFilter && !a.tags.includes(tagFilter)) return false;
    if (pageFilter.trim() !== "") {
      // Compare as numbers: a string compare makes "01" or a stray space match
      // nothing, with no indication why the list went empty.
      const wanted = Number(pageFilter);
      const page = a.anchor.zoteroPosition?.pageIndex;
      if (!Number.isFinite(wanted) || page == null || page + 1 !== wanted) return false;
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

  function beginEdit(a: ReaderAnnotation) {
    setEditingId(a.id);
    setDraftComment(a.comment);
    setDraftTags(a.tags.join(", "));
  }

  async function saveEdit(a: ReaderAnnotation) {
    if (!onUpdateLocal) return;
    setBusyId(a.id);
    try {
      const tagsNext = draftTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await onUpdateLocal(a.id, { comment: draftComment, tags: tagsNext });
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <aside className="pdf-reader-sidebar" aria-label="Annotations">
      <div className="pdf-reader-sidebar-filters">
        <Select
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
        </Select>
        <Select
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
        </Select>
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
          const pinKey = annotationPinKey(a);
          const pinnedSection = pinsByKey?.get(pinKey) ?? null;
          const localEditable = canEditLocal && a.origin === "local";
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
                    {a.origin === "local" ? "local · " : ""}
                    {a.syncState ? `${a.syncState} · ` : ""}
                    {a.type}
                    {a.anchor.zoteroPosition
                      ? ` · p.${a.anchor.zoteroPosition.pageIndex + 1}`
                      : ""}
                    {qType ? ` · ${QUOTATION_TYPE_LABELS[qType]}` : ""}
                  </span>
                  {a.text && <span className="pdf-reader-sidebar-text">{a.text}</span>}
                  {a.comment && editingId !== a.id && (
                    <span className="muted">{a.comment}</span>
                  )}
                </span>
              </button>
              <div className="pdf-reader-sidebar-actions">
                {(a.text || a.comment) && (
                  <button type="button" className="link-btn" onClick={() => void copyCite(a)}>
                    Copy quote + cite
                  </button>
                )}
                {localEditable && editingId !== a.id && (
                  <>
                    <button type="button" className="link-btn" onClick={() => beginEdit(a)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={busyId === a.id}
                      onClick={() => void onRemoveLocal?.(a.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
              {localEditable && editingId === a.id && (
                <div className="pdf-reader-sidebar-edit">
                  <textarea
                    aria-label="Comment"
                    value={draftComment}
                    onChange={(e) => setDraftComment(e.target.value)}
                    rows={2}
                  />
                  <input
                    aria-label="Tags"
                    placeholder="tags, comma, separated"
                    value={draftTags}
                    onChange={(e) => setDraftTags(e.target.value)}
                  />
                  <div className="pdf-reader-create-colors" role="group" aria-label="Colour">
                    {READER_ANNOTATION_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="pdf-reader-create-swatch"
                        style={{ background: color }}
                        aria-label={`Set colour ${color}`}
                        disabled={busyId === a.id}
                        onClick={() => void onUpdateLocal?.(a.id, { color })}
                      />
                    ))}
                  </div>
                  <div className="pdf-reader-sidebar-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busyId === a.id}
                      onClick={() => void saveEdit(a)}
                    >
                      Save
                    </button>
                    <button type="button" className="link-btn" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {localEditable && reportSections.length > 0 && onPinLocal && (
                <label className="pdf-reader-sidebar-pin">
                  <span className="muted">Pin to section</span>
                  <Select
                    aria-label="Pin annotation to report section"
                    value={pinnedSection ?? ""}
                    disabled={busyId === a.id}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      void onPinLocal(a, v);
                    }}
                  >
                    <option value="">Not pinned</option>
                    {reportSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title || "Untitled section"}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="muted">No annotations match these filters.</li>
        )}
      </ul>
      {backlinks.length > 0 && (
        <div className="pdf-reader-backlinks" aria-label="Annotation backlinks">
          <strong>Cited in</strong>
          <ul>
            {backlinks.map((b) => (
              <li key={`${b.kind}:${b.id}`}>
                <Link
                  href={
                    b.kind === "report_section"
                      ? `/report?section=${encodeURIComponent(b.id)}`
                      : `/vault?page=${encodeURIComponent(b.id)}`
                  }
                >
                  {b.kind === "report_section" ? "Report" : "Note"} · {b.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
