"use client";

import { useEffect, useMemo, useState } from "react";
import {
  findDocumentMatches,
  nextMatchIndex,
  type DocumentPageText,
  type DocumentSearchMatch,
} from "@weaveforge/core";
import { ChevronIcon } from "@/components/chevron-icon";

interface ReaderSearchBarProps {
  pages: DocumentPageText[];
  onJump: (match: DocumentSearchMatch) => void;
  /** Every match and the stepped-to one, so the pages can paint them. */
  onMatches?: (matches: DocumentSearchMatch[], active: number) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ReaderSearchBar({
  pages,
  onJump,
  onMatches,
  isOpen,
  onOpenChange,
}: ReaderSearchBarProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = (val: boolean) => {
    setInternalOpen(val);
    onOpenChange?.(val);
  };
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const matches = useMemo(() => findDocumentMatches(pages, query), [pages, query]);
  useEffect(() => {
    onMatches?.(matches, active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, active]);

  function jump(direction: 1 | -1) {
    if (matches.length === 0) return;
    const next = nextMatchIndex(active, matches.length, direction);
    setActive(next);
    const match = matches[next];
    if (match) onJump(match);
  }

  if (!open && !query.trim()) {
    return (
      <button
        type="button"
        className="btn-secondary btn-sm pdf-reader-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Find in document"
        title="Find in document (⌘F / Ctrl+F)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2" />
        </svg>
        <span>Find</span>
      </button>
    );
  }

  return (
    <div className="pdf-reader-search is-open" role="search">
      <input
        type="search"
        autoFocus
        placeholder="Find in document…"
        value={query}
        aria-label="Find in document"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            jump(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (!query.trim()) setOpen(false);
            else setQuery("");
          }
        }}
      />
      {/* The count and the steppers only once there is something to step
          through: an empty find field is one quiet box, not five controls. */}
      {query.trim() && (
        <>
          <span className="muted pdf-reader-search-count">
            {matches.length ? `${active < 0 ? 0 : active + 1}/${matches.length}` : "0/0"}
          </span>
          <button
            type="button"
            className="pdf-reader-search-step"
            disabled={!matches.length}
            onClick={() => jump(-1)}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
          >
            <ChevronIcon open size={14} />
          </button>
          <button
            type="button"
            className="pdf-reader-search-step"
            disabled={!matches.length}
            onClick={() => jump(1)}
            aria-label="Next match"
            title="Next match (Enter)"
          >
            <ChevronIcon size={14} />
          </button>
        </>
      )}
      <button
        type="button"
        className="pdf-reader-search-close"
        onClick={() => {
          setQuery("");
          setOpen(false);
        }}
        aria-label="Close search"
        title="Close (Escape)"
      >
        ✕
      </button>
    </div>
  );
}
