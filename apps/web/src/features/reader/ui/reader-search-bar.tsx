"use client";

import { useMemo, useState } from "react";
import {
  findDocumentMatches,
  nextMatchIndex,
  type DocumentPageText,
  type DocumentSearchMatch,
} from "@thesis/core";

interface ReaderSearchBarProps {
  pages: DocumentPageText[];
  onJump: (match: DocumentSearchMatch) => void;
}

export function ReaderSearchBar({ pages, onJump }: ReaderSearchBarProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const matches = useMemo(() => findDocumentMatches(pages, query), [pages, query]);

  function jump(direction: 1 | -1) {
    if (matches.length === 0) return;
    const next = nextMatchIndex(active, matches.length, direction);
    setActive(next);
    const match = matches[next];
    if (match) onJump(match);
  }

  return (
    <div className="pdf-reader-search" role="search">
      <input
        type="search"
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
          }
        }}
      />
      <span className="muted pdf-reader-search-count">
        {query.trim()
          ? matches.length
            ? `${active < 0 ? 0 : active + 1}/${matches.length}`
            : "0/0"
          : ""}
      </span>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={!matches.length}
        onClick={() => jump(-1)}
      >
        Prev
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={!matches.length}
        onClick={() => jump(1)}
      >
        Next
      </button>
    </div>
  );
}
