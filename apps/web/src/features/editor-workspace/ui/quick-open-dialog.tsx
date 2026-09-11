"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { NavIcon } from "@/app/nav-icon";
import { groupResults, quickOpenResults } from "../application/quick-open";
import type { WorkspaceTreeNode } from "../application/workspace-tree";
import { kindIcon } from "./kind";

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
            // Results are grouped by kind, in root order, so Notes, Papers,
            // Lists and Report hits do not interleave. The flat index is kept
            // for keyboard navigation — arrows walk the whole list, not a
            // group at a time.
            groupResults(results).map((group) => (
              <li key={group.kind} role="presentation">
                <p className="quick-open-group" aria-hidden="true">
                  {group.label}
                </p>
                <ul className="quick-open-group-rows" role="presentation">
                  {group.results.map((result) => {
                    const index = results.indexOf(result);
                    return (
                      <li key={result.node.key} role="presentation">
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
                          <span className="quick-open-kind" aria-hidden="true">
                            <NavIcon name={kindIcon(result.node.kind)} />
                          </span>
                          <span className="quick-open-title">{result.node.label}</span>
                          {/* The path is the match target, so the characters
                              that matched are the ones worth marking. The
                              scorer has computed these indices since the
                              palette shipped; nothing rendered them. */}
                          <span className="quick-open-path">
                            {highlight(result.node.path, result.matched)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/** Wrap the matched characters of `text` in `<mark>`, in order. */
function highlight(text: string, matched: readonly number[]): React.ReactNode {
  if (matched.length === 0) return text;
  const positions = new Set(matched);
  const out: React.ReactNode[] = [];
  let buffer = "";
  const flush = (key: number) => {
    if (buffer) out.push(<span key={`t${key}`}>{buffer}</span>);
    buffer = "";
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (positions.has(index)) {
      flush(index);
      out.push(<mark key={`m${index}`}>{char}</mark>);
    } else {
      buffer += char;
    }
  }
  flush(text.length);
  return out;
}
