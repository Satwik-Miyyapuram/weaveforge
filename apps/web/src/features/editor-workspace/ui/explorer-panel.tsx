"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChevronIcon } from "@/components/chevron-icon";
import { FolderIcon } from "@/components/view-icons";
import { NavIcon } from "@/app/nav-icon";
import {
  collapseAll,
  expandAll,
  isSectionOpen,
  readExpanded,
  readSections,
  toggleExpanded,
  toggleSection,
  writeExpanded,
  writeSections,
  type ExplorerSection,
  type SectionState,
} from "../application/explorer-state";
import {
  filterRows,
  visibleRows,
  type TreeNodeKind,
  type VisibleRow,
  type WorkspaceTreeNode,
} from "../application/workspace-tree";
import { documentSuffix, kindIcon, kindIconClass } from "./kind";

export interface ExplorerSelection {
  kind: TreeNodeKind;
  id: string;
}

/** One row plus the position it sits at in the panel's single flat list. */
interface PaintedRow extends VisibleRow {
  index: number;
}

/**
 * The left panel: the workspace as a stack of sections.
 *
 * Three sections — Files, Reading lists, Outline — the way VS Code stacks
 * Explorer / Outline / Timeline: each with its own header, its own collapse and
 * its own data source. Files is the mirror folder; Reading lists is a view over
 * the *same* papers and notes seen through the lists they belong to, which is
 * why the same document can appear in both without either being a copy.
 *
 * Rows are painted from a flattened list rather than by recursing in JSX, so
 * arrow-key navigation is "the next row" instead of a tree walk, and a single
 * roving tabindex keeps the whole panel one tab stop. There is no Unicode
 * glyph left in this file: every mark is an SVG on the app's 24 grid, at the
 * stroke weight of the set it belongs to.
 */
export function ExplorerPanel({
  sections,
  activeKey,
  onOpen,
  onStartNote,
  onRelease,
  onNewNote,
  onNewFolder,
  onRefresh,
  newNoteLabel = "New note",
  gitStatus,
  listNames,
}: {
  sections: readonly ExplorerSection[];
  /** The document currently focused in a pane, highlighted here. */
  activeKey?: string;
  onOpen: (selection: ExplorerSelection) => void;
  /** Offered on a paper that has no note yet. */
  onStartNote?: (paperId: string) => void;
  /**
   * A row that is not a document — an Outline heading. It scrolls rather than
   * opening, and this is the only thing the panel does with it.
   */
  onRelease?: (node: WorkspaceTreeNode) => void;
  onNewNote?: () => void;
  onNewFolder?: () => void;
  onRefresh?: () => void;
  newNoteLabel?: string;
  /** `M` / `U` ticks, keyed by tree key. Absent where git is not watching. */
  gitStatus?: ReadonlyMap<string, string>;
  /** Which lists a document belongs to, for the "N lists" hint. */
  listNames?: ReadonlyMap<string, string[]>;
}) {
  // Read after mount: the server render has no `localStorage`, and deciding
  // there would ship a tree that jumps open on hydration.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readExpanded(undefined));
  const [openSections, setOpenSections] = useState<SectionState>(() =>
    readSections(undefined, sections),
  );
  const [query, setQuery] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const store = typeof localStorage === "undefined" ? undefined : localStorage;
    setExpanded(readExpanded(store));
    setOpenSections(readSections(store, sections));
    // The sections arrive once their data has loaded. Re-reading on every
    // change would undo the expansion the user has just made as the tree fills
    // in, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The filter narrows every section at once and opens whatever it matched.
  const filtered = useMemo(() => {
    const forced = new Set<string>();
    const byId = new Map<string, VisibleRow[]>();
    for (const section of sections) {
      const rows = visibleRows(section.tree, expanded);
      const result = filterRows(rows, query);
      for (const key of result.expand) forced.add(key);
      byId.set(section.id, result.rows);
    }
    return { byId, forced };
  }, [sections, expanded, query]);

  const effectiveExpanded = useMemo(
    () => (query.trim() ? new Set([...expanded, ...filtered.forced]) : expanded),
    [expanded, filtered.forced, query],
  );

  const persistExpanded = useCallback((next: ReadonlySet<string>) => {
    writeExpanded(typeof localStorage === "undefined" ? undefined : localStorage, next);
  }, []);

  const setOpen = useCallback(
    (key: string) => {
      setExpanded((current) => {
        const next = toggleExpanded(current, key);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const onCollapseAll = useCallback(() => {
    const next = collapseAll();
    setExpanded(next);
    persistExpanded(next);
  }, [persistExpanded]);

  const onExpandAll = useCallback(() => {
    const next = expandAll(sections.flatMap((section) => section.tree));
    setExpanded(next);
    persistExpanded(next);
  }, [persistExpanded, sections]);

  const onToggleSection = useCallback((id: string) => {
    setOpenSections((current) => {
      const next = toggleSection(current, id);
      writeSections(typeof localStorage === "undefined" ? undefined : localStorage, next);
      return next;
    });
  }, []);

  const activate = useCallback(
    (node: WorkspaceTreeNode) => {
      // An Outline heading is not a document: it scrolls the pane rather than
      // opening a tab, which is the only thing that makes it useful.
      if (node.headingLevel !== undefined) {
        onRelease?.(node);
        return;
      }
      if (node.children.length > 0 || node.kind === "folder") setOpen(node.key);
      if (node.id && node.kind !== "folder") onOpen({ kind: node.kind, id: node.id });
    },
    [onOpen, onRelease, setOpen],
  );

  // Focus follows the roving tabindex, so the browser scrolls the row into view
  // for us and screen readers announce the move.
  const focusRow = useCallback((key: string) => {
    setFocusKey(key);
    listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus();
  }, []);

  // One flat list across every open section is what makes an arrow key mean
  // "the next row" rather than "the next row in this section".
  const flat = useMemo<PaintedRow[]>(
    () =>
      sections
        .flatMap((section) =>
          isSectionOpen(openSections, section.id) ? (filtered.byId.get(section.id) ?? []) : [],
        )
        .map((row, index) => ({ ...row, index })),
    [sections, openSections, filtered.byId],
  );

  const onKeyDown = (event: React.KeyboardEvent, row: PaintedRow) => {
    const { node } = row;
    const step = (delta: number) => {
      const next = flat[row.index + delta];
      if (!next) return;
      event.preventDefault();
      focusRow(next.node.key);
    };

    if (event.key === "ArrowDown") return step(1);
    if (event.key === "ArrowUp") return step(-1);
    if (event.key === "Home") {
      event.preventDefault();
      if (flat[0]) focusRow(flat[0].node.key);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = flat[flat.length - 1];
      if (last) focusRow(last.node.key);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (node.children.length === 0) return;
      // Right on an open row moves into it, which is what makes a keyboard walk
      // down a deep tree feel like one gesture rather than open-then-descend.
      if (effectiveExpanded.has(node.key)) step(1);
      else setOpen(node.key);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.children.length > 0 && effectiveExpanded.has(node.key)) {
        setOpen(node.key);
        return;
      }
      // Otherwise climb: the nearest row above with a smaller indent.
      const depth = row.depth;
      for (let i = row.index - 1; i >= 0; i--) {
        if (flat[i]!.depth < depth) {
          focusRow(flat[i]!.node.key);
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

  const focused = flat.some((row) => row.node.key === focusKey)
    ? focusKey
    : (flat[0]?.node.key ?? null);

  return (
    <nav className="explorer-panel" aria-label="Workspace">
      {/* Head: the panel's name and its actions. 36px, with the filter on the
          row below it, so the panel reads as a titled surface rather than as a
          search box with a tree under it. */}
      <div className="explorer-head">
        <span className="explorer-title">Explorer</span>
        <div className="explorer-head-actions">
          {onNewNote ? (
            <button
              type="button"
              className="explorer-action"
              title={newNoteLabel}
              aria-label={newNoteLabel}
              onClick={onNewNote}
            >
              <NavIcon name="pencil" />
            </button>
          ) : null}
          {onNewFolder ? (
            <button
              type="button"
              className="explorer-action"
              title="New folder"
              aria-label="New folder"
              onClick={onNewFolder}
            >
              <FolderIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="explorer-action"
            title="Collapse all"
            aria-label="Collapse all"
            onClick={onCollapseAll}
          >
            <ChevronIcon open variant="expand" />
          </button>
          <button
            type="button"
            className="explorer-action"
            title="Expand all"
            aria-label="Expand all"
            onClick={onExpandAll}
          >
            <ChevronIcon variant="expand" />
          </button>
          {onRefresh ? (
            <button
              type="button"
              className="explorer-action"
              title="Refresh"
              aria-label="Refresh"
              onClick={onRefresh}
            >
              <RefreshGlyph />
            </button>
          ) : null}
        </div>
      </div>

      {/* The tree is the only navigation and had no way to search it: quick
          open covers documents, never folders or lists. This matches the label
          *and* the path, so `.list` narrows to lists. */}
      <div className="explorer-search">
        <input
          type="search"
          className="explorer-filter"
          placeholder="Filter files…"
          aria-label="Filter files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        {query ? (
          <button
            type="button"
            className="explorer-filter-clear"
            aria-label="Clear filter"
            title="Clear filter"
            onClick={() => setQuery("")}
          >
            <CloseGlyph />
          </button>
        ) : null}
      </div>

      <div className="explorer-body">
        <ul className="explorer-tree" role="tree" ref={listRef}>
          {sections.map((section) => {
            const open = isSectionOpen(openSections, section.id);
            const rows = filtered.byId.get(section.id) ?? [];
            return (
              <li
                key={section.id}
                role="none"
                className={`explorer-section${open ? "" : " is-collapsed"}`}
              >
                <div className="explorer-section-head">
                  {/* The header *is* the collapse control. */}
                  <button
                    type="button"
                    className="explorer-section-toggle"
                    aria-expanded={open}
                    aria-controls={`explorer-section-${section.id}`}
                    onClick={() => onToggleSection(section.id)}
                  >
                    <ChevronIcon open={open} variant="expand" />
                    <span className="explorer-section-title">{section.title}</span>
                    {rows.length > 0 ? (
                      <span className="explorer-section-count">{rows.length}</span>
                    ) : null}
                  </button>
                </div>
                <ul
                  id={`explorer-section-${section.id}`}
                  className="explorer-section-rows"
                  role="group"
                  hidden={!open}
                >
                  {rows.map((row) => {
                    const { node, depth } = row;
                    const painted = flat.find((candidate) => candidate.node.key === node.key);
                    const branch = node.children.length > 0;
                    const rowOpen = effectiveExpanded.has(node.key);
                    const suffix = node.kind === "folder" ? null : documentSuffix(node.kind);
                    const lists = node.id ? listNames?.get(`${node.kind}:${node.id}`) : undefined;
                    const git = gitStatus?.get(node.key);
                    const tint = kindIconClass(node.kind, rowOpen);
                    const title = [
                      node.path,
                      lists && lists.length > 0
                        ? `${lists.length} list${lists.length === 1 ? "" : "s"}: ${lists.join(", ")}`
                        : null,
                      node.inheritedFrom ? `Inherited from ${node.inheritedFrom}` : null,
                    ]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <li key={node.key} role="none">
                        <div
                          role="treeitem"
                          data-row-key={node.key}
                          aria-level={depth + 1}
                          aria-expanded={branch ? rowOpen : undefined}
                          aria-selected={node.key === activeKey}
                          aria-current={node.key === activeKey ? "true" : undefined}
                          tabIndex={node.key === focused ? 0 : -1}
                          title={title}
                          className={[
                            "explorer-row",
                            node.key === activeKey ? "is-active" : "",
                            node.isMember ? "is-member" : "",
                            node.inherited ? "is-inherited" : "",
                            rowOpen ? "is-open" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          style={{ paddingInlineStart: `${8 + depth * 16}px` }}
                          onClick={() => {
                            setFocusKey(node.key);
                            activate(node);
                          }}
                          onKeyDown={(event) => painted && onKeyDown(event, painted)}
                        >
                          {/* One 1px rule per level, 5px inside each 16px step. */}
                          {Array.from({ length: depth }, (_, level) => (
                            <span
                              key={level}
                              className="explorer-guide"
                              aria-hidden="true"
                              style={{ insetInlineStart: `${8 + 16 * (level + 1) - 5}px` }}
                            />
                          ))}
                          <span className="explorer-twisty" aria-hidden="true">
                            {branch ? <ChevronIcon open={rowOpen} variant="expand" /> : null}
                          </span>
                          <span className={`explorer-icon${tint ? ` ${tint}` : ""}`} aria-hidden="true">
                            {node.kind === "folder" ? (
                              <FolderIcon />
                            ) : (
                              <NavIcon name={kindIcon(node.kind)} />
                            )}
                          </span>
                          <span className="explorer-label">{node.label}</span>
                          {/* An Outline row says its heading level in mono,
                              where a file row would carry its kind suffix. */}
                          {node.headingLevel !== undefined ? (
                            <span className="explorer-heading-level">H{node.headingLevel}</span>
                          ) : null}
                          {/* Membership is discoverable without opening the
                              second section. */}
                          {lists && lists.length > 0 ? (
                            <span className="explorer-in-lists">
                              {lists.length} list{lists.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {git ? (
                            <span
                              className={`explorer-git is-${git === "M" ? "modified" : "untracked"}`}
                              aria-label={git === "M" ? "Modified" : "Untracked"}
                            >
                              {git}
                            </span>
                          ) : null}
                          {suffix ? <span className="explorer-ext">{suffix}</span> : null}
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
                  {open && rows.length === 0 ? (
                    <li role="none" className="explorer-section-empty muted">
                      {query.trim() ? "No matches" : "Nothing here yet"}
                    </li>
                  ) : null}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function RefreshGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}
