"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  readExpanded,
  toggleExpanded,
  writeExpanded,
} from "../application/explorer-state";
import {
  visibleRows,
  type WorkspaceTreeNode,
  type TreeNodeKind,
} from "../application/workspace-tree";

const KIND_ICON: Record<TreeNodeKind, string> = {
  folder: "▸",
  vault_page: "◆",
  paper: "❐",
  reading_list: "☰",
  report_section: "§",
  experiment: "⚗",
  milestone: "◎",
  log_entry: "✎",
};

export interface ExplorerSelection {
  kind: TreeNodeKind;
  id: string;
}

/**
 * The left panel: the workspace as a tree of documents.
 *
 * Rows are painted from a flattened list rather than by recursing in JSX, so
 * arrow-key navigation is "the next row" instead of a tree walk, and a single
 * roving tabindex keeps the whole panel one tab stop.
 */
export function ExplorerPanel({
  tree,
  activeKey,
  onOpen,
  onStartNote,
}: {
  tree: readonly WorkspaceTreeNode[];
  /** The document currently focused in a pane, highlighted here. */
  activeKey?: string;
  onOpen: (selection: ExplorerSelection) => void;
  /** Offered on a paper that has no note yet. */
  onStartNote?: (paperId: string) => void;
}) {
  // Read after mount: the server render has no `localStorage`, and deciding
  // there would ship a tree that jumps open on hydration.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readExpanded(undefined));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setExpanded(readExpanded(typeof localStorage === "undefined" ? undefined : localStorage));
  }, []);

  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  const focused = rows.some((row) => row.node.key === focusKey) ? focusKey : (rows[0]?.node.key ?? null);

  const setOpen = useCallback((key: string) => {
    setExpanded((current) => {
      const next = toggleExpanded(current, key);
      writeExpanded(typeof localStorage === "undefined" ? undefined : localStorage, next);
      return next;
    });
  }, []);

  const activate = useCallback(
    (node: WorkspaceTreeNode) => {
      if (node.children.length > 0 || node.kind === "folder") setOpen(node.key);
      if (node.id && node.kind !== "folder") onOpen({ kind: node.kind, id: node.id });
    },
    [onOpen, setOpen],
  );

  // Focus follows the roving tabindex, so the browser scrolls the row into view
  // for us and screen readers announce the move.
  const focusRow = useCallback((key: string) => {
    setFocusKey(key);
    listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent, node: WorkspaceTreeNode, index: number) => {
    const step = (delta: number) => {
      const next = rows[index + delta];
      if (!next) return;
      event.preventDefault();
      focusRow(next.node.key);
    };

    if (event.key === "ArrowDown") return step(1);
    if (event.key === "ArrowUp") return step(-1);
    if (event.key === "Home") {
      event.preventDefault();
      if (rows[0]) focusRow(rows[0].node.key);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = rows[rows.length - 1];
      if (last) focusRow(last.node.key);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      // Right on an open row moves into it, which is what makes a keyboard walk
      // down a deep tree feel like one gesture rather than open-then-descend.
      if (node.children.length === 0) return;
      if (expanded.has(node.key)) step(1);
      else setOpen(node.key);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.children.length > 0 && expanded.has(node.key)) {
        setOpen(node.key);
        return;
      }
      // Otherwise climb: the nearest row above with a smaller indent.
      const depth = rows[index]!.depth;
      for (let i = index - 1; i >= 0; i--) {
        if (rows[i]!.depth < depth) {
          focusRow(rows[i]!.node.key);
          return;
        }
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(node);
    }
  };

  return (
    <nav className="explorer-panel" aria-label="Workspace">
      <ul className="explorer-tree" role="tree" ref={listRef}>
        {rows.map(({ node, depth }, index) => {
          const branch = node.children.length > 0;
          const open = expanded.has(node.key);
          return (
            <li key={node.key} role="none">
              <div
                role="treeitem"
                data-row-key={node.key}
                aria-level={depth + 1}
                aria-expanded={branch ? open : undefined}
                aria-selected={node.key === activeKey}
                aria-current={node.key === activeKey ? "true" : undefined}
                tabIndex={node.key === focused ? 0 : -1}
                title={node.path}
                className={`explorer-row${node.key === activeKey ? " is-active" : ""}`}
                style={{ paddingInlineStart: `${depth * 0.85 + 0.35}rem` }}
                onClick={() => {
                  setFocusKey(node.key);
                  activate(node);
                }}
                onKeyDown={(event) => onKeyDown(event, node, index)}
              >
                <span className="explorer-twisty" aria-hidden="true">
                  {branch ? (open ? "▾" : "▸") : ""}
                </span>
                <span className="explorer-icon" aria-hidden="true">
                  {KIND_ICON[node.kind]}
                </span>
                <span className="explorer-label">{node.label}</span>
                {node.missingNote && onStartNote && node.id ? (
                  <button
                    type="button"
                    className="explorer-start-note"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartNote(node.id!);
                    }}
                  >
                    Start note
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
