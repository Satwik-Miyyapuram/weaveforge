"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { quickOpenResults } from "../application/quick-open";
import type { WorkspaceTreeNode } from "../application/workspace-tree";

/**
 * The Ctrl/Cmd-P palette.
 *
 * Enter opens in the focused pane; Ctrl-Enter opens in a new split, which is
 * the fastest way to get two documents side by side without touching the mouse.
 */
export function QuickOpenDialog({
  documents,
  onPick,
  onClose,
}: {
  documents: readonly WorkspaceTreeNode[];
  onPick: (node: WorkspaceTreeNode, options: { split: boolean }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus goes into the palette on open and back where it came from on close,
  // so dismissing with Escape leaves the caret in the editor the user was in
  // rather than on the document body.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const results = useMemo(() => quickOpenResults(documents, query), [documents, query]);
  const active = Math.min(cursor, Math.max(results.length - 1, 0));

  return (
    <div
      className="quick-open-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="quick-open" role="dialog" aria-modal="true" aria-label="Open document">
        <input
          ref={inputRef}
          className="quick-open-input search-input"
          value={query}
          placeholder="Go to file — try a name, a folder, or .report"
          aria-label="Search documents"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") return onClose();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
              return;
            }
            if (event.key === "Enter") {
              const picked = results[active];
              if (!picked) return;
              event.preventDefault();
              onPick(picked.node, { split: event.ctrlKey || event.metaKey });
            }
          }}
        />
        <ul className="quick-open-results" role="listbox" aria-label="Matching documents">
          {results.length === 0 ? (
            <li className="muted quick-open-empty">Nothing matches “{query}”.</li>
          ) : (
            results.map((result, index) => (
              <li key={result.node.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`quick-open-result${index === active ? " is-active" : ""}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={(event) =>
                    onPick(result.node, { split: event.ctrlKey || event.metaKey })
                  }
                >
                  <span className="quick-open-title">{result.node.label}</span>
                  <span className="quick-open-path">{result.node.path}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
