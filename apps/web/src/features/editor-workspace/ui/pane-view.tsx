"use client";

import type { ReactNode } from "react";

import { NavIcon } from "@/app/nav-icon";
import type { Crumb } from "../application/breadcrumbs";
import { shortcutTable, type WorkspaceCommand } from "../application/keybindings";
import {
  activeTab,
  leaves,
  tabKey,
  tabMode,
  type DocumentMode,
  type PaneLayout,
  type PaneLeaf,
  type PaneNode,
  type PaneSplit,
  type TabRef,
} from "../application/pane-tree";
import { Breadcrumbs } from "./breadcrumbs";
import { kindIcon, kindSuffix, kindTintClass } from "./kind";
import { Minimap, viewportFraction } from "./minimap";
import type { DocumentMetrics } from "./document-host";

export interface PaneActions {
  onActivate: (paneId: string, index: number) => void;
  onClose: (paneId: string, index: number) => void;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, direction: PaneSplit["direction"]) => void;
  onDropTab: (from: { paneId: string; index: number }, toPaneId: string) => void;
  onRatio: (split: PaneSplit, ratio: number) => void;
  /** Flip the addressed tab between Edit and Read. */
  onToggleMode: (paneId: string, index: number) => void;
  onSetMode: (paneId: string, index: number, mode: DocumentMode) => void;
}

export interface PaneViewProps extends PaneActions {
  layout: PaneLayout;
  /** What a tab is called in its header — the entity's title, not its path. */
  labelFor: (tab: TabRef) => string;
  /** The editor for a tab. One call per open tab, not per visible tab. */
  renderDocument: (tab: TabRef) => ReactNode;
  /** Editors this tab is live in. Rendered as avatars at the right of the strip. */
  peers?: (tab: TabRef) => readonly string[];
  /** The path to a document, for the strip above the pane. */
  crumbsFor?: (tab: TabRef) => readonly Crumb[];
  /** What the active renderer reports about itself, tab by tab. */
  metricsFor?: (tab: TabRef) => DocumentMetrics | undefined;
  /** The body of a document, for the minimap. */
  bodyFor?: (tab: TabRef) => string;
  /** A crumb click: open the document the crumb names. */
  onOpenCrumb?: (crumb: Crumb) => void;
}

/**
 * Renders the pane tree. It decides nothing: every gesture calls back into
 * `pane-tree.ts`, which is where the layout rules are tested.
 *
 * Inactive tabs stay mounted and hidden rather than being unmounted. An editor
 * that unmounts loses its scroll position, its undo history and its CRDT
 * binding, so switching tabs would silently discard the thing tabs exist to
 * preserve.
 */
export function PaneView(props: PaneViewProps) {
  return (
    <div className="pane-root">
      <PaneNodeView node={props.layout.root} {...props} />
    </div>
  );
}

function PaneNodeView({ node, ...props }: PaneViewProps & { node: PaneNode }) {
  if (node.type === "leaf") return <PaneLeafView leaf={node} {...props} />;

  const split = node;
  const vertical = split.direction === "column";
  return (
    <div className={`pane-split pane-split-${split.direction}`}>
      <div className="pane-half" style={{ flex: `${split.ratio} 1 0` }}>
        <PaneNodeView node={split.children[0]} {...props} />
      </div>
      <div
        className="pane-divider"
        role="separator"
        aria-orientation={vertical ? "horizontal" : "vertical"}
        aria-label="Resize panes"
        tabIndex={0}
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -0.05 : 0.05;
          if (Math.abs(step) && /^Arrow(Left|Right|Up|Down)$/.test(event.key)) {
            event.preventDefault();
            props.onRatio(split, split.ratio + step);
          }
        }}
        onPointerDown={(event) => {
          const host = event.currentTarget.parentElement;
          if (!host) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const box = host.getBoundingClientRect();
          const move = (moveEvent: PointerEvent) => {
            const fraction = vertical
              ? (moveEvent.clientY - box.top) / box.height
              : (moveEvent.clientX - box.left) / box.width;
            props.onRatio(split, fraction);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <div className="pane-half" style={{ flex: `${1 - split.ratio} 1 0` }}>
        <PaneNodeView node={split.children[1]} {...props} />
      </div>
    </div>
  );
}

function PaneLeafView({
  leaf,
  layout,
  labelFor,
  renderDocument,
  peers,
  crumbsFor,
  metricsFor,
  bodyFor,
  onOpenCrumb,
  onActivate,
  onClose,
  onFocus,
  onSplit,
  onDropTab,
  onSetMode,
}: PaneViewProps & { leaf: PaneLeaf }) {
  const focused = layout.focusedPaneId === leaf.id;
  const showing = activeTab(leaf);
  const editing = showing ? tabMode(showing) : "edit";
  const peerNames = showing ? (peers?.(showing) ?? []) : [];
  const crumbs = showing ? (crumbsFor?.(showing) ?? []) : [];
  const metrics = showing ? metricsFor?.(showing) : undefined;
  const body = showing ? (bodyFor?.(showing) ?? "") : "";
  // A renderer that reports no text — an ink page — gets no minimap column,
  // and the pane lays out without it rather than showing an empty rail.
  const showMinimap = Boolean(showing) && editing === "edit" && metrics?.text !== undefined;
  const totalLines = body ? body.replace(/\r\n/g, "\n").split("\n").length : 0;
  const fraction = showMinimap ? viewportFraction(metrics, totalLines) : null;

  return (
    <section
      className={`pane${focused ? " is-focused" : ""}`}
      onFocusCapture={() => onFocus(leaf.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const raw = event.dataTransfer.getData("application/x-weaveforge-tab");
        if (!raw) return;
        const [paneId, index] = raw.split("|");
        if (paneId && index) onDropTab({ paneId, index: Number(index) }, leaf.id);
      }}
    >
      <div className="pane-tabs" role="tablist" aria-label="Open documents">
        {leaf.tabs.map((tab, index) => {
          const isActive = index === leaf.activeIndex;
          const suffix = kindSuffix(tab.kind);
          return (
            <div
              key={tabKey(tab)}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData("application/x-weaveforge-tab", `${leaf.id}|${index}`)
              }
              className={`pane-tab${isActive ? " is-active" : ""}`}
              onClick={() => onActivate(leaf.id, index)}
              onAuxClick={(event) => {
                // Middle-click closes, as every tabbed editor does.
                if (event.button === 1) onClose(leaf.id, index);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onActivate(leaf.id, index);
                }
              }}
            >
              <span className={`pane-tab-icon ${tintClass(tab.kind)}`} aria-hidden="true">
                <NavIcon name={kindIcon(tab.kind)} />
              </span>
              <span className="pane-tab-label">{labelFor(tab)}</span>
              {suffix ? <span className="pane-tab-ext">{suffix}</span> : null}
              <button
                type="button"
                className="pane-tab-close"
                aria-label={`Close ${labelFor(tab)}`}
                title={`Close ${labelFor(tab)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(leaf.id, index);
                }}
              >
                <CloseGlyph />
              </button>
            </div>
          );
        })}
        <div className="pane-tab-actions">
          {leaf.tabs.length > 0 && showing ? (
            // Edit / Read, per tab. Two segments rather than a toggle button so
            // the current mode is readable without hovering.
            <div className="pane-mode" role="group" aria-label="Document mode">
              <button
                type="button"
                className={`pane-mode-btn${editing === "edit" ? " is-on" : ""}`}
                aria-pressed={editing === "edit"}
                title="Edit source (⌘E)"
                onClick={() => onSetMode(leaf.id, leaf.activeIndex, "edit")}
              >
                Edit
              </button>
              <button
                type="button"
                className={`pane-mode-btn${editing === "read" ? " is-on" : ""}`}
                aria-pressed={editing === "read"}
                title="Read view (⌘E)"
                onClick={() => onSetMode(leaf.id, leaf.activeIndex, "read")}
              >
                Read
              </button>
            </div>
          ) : null}
          {peerNames.length > 0 ? (
            // Collaboration exists, but it used to be announced *inside* the
            // document as a line of text. Presence belongs in the chrome.
            <span className="pane-peers" role="status" aria-label={`Also editing: ${peerNames.join(", ")}`}>
              {peerNames.slice(0, 4).map((name) => (
                <span className="pane-peer" key={name} title={name}>
                  {initials(name)}
                </span>
              ))}
            </span>
          ) : null}
          <button
            type="button"
            className="pane-action"
            aria-label="Split right"
            title="Split right"
            onClick={() => onSplit(leaf.id, "row")}
          >
            <SplitGlyph direction="row" />
          </button>
          <button
            type="button"
            className="pane-action"
            aria-label="Split down"
            title="Split down"
            onClick={() => onSplit(leaf.id, "column")}
          >
            <SplitGlyph direction="column" />
          </button>
        </div>
      </div>

      {/* The explorer collapses and the tab strip says only the title; the path
          must not. The last crumb carries the kind suffix, because there the
          crumb *is* the path. */}
      {showing ? (
        <Breadcrumbs crumbs={crumbs} kind={showing.kind} onOpen={onOpenCrumb} />
      ) : null}

      <div className={`pane-body-wrap${showMinimap ? " has-minimap" : ""}`}>
        <div className="pane-body">
          {leaf.tabs.length === 0 ? (
            <EmptyState />
          ) : (
            leaf.tabs.map((tab) => (
              // Hidden rather than unmounted: an editor that unmounts loses its
              // scroll position, its undo history and its live binding.
              <div
                key={tabKey(tab)}
                className="pane-document"
                hidden={showing === undefined || tabKey(tab) !== tabKey(showing)}
              >
                {renderDocument(tab)}
              </div>
            ))
          )}
        </div>
        {showMinimap ? <Minimap body={body} fraction={fraction} /> : null}
      </div>
    </section>
  );
}

/**
 * The empty state, replacing one grey sentence.
 *
 * The mark, heading and line of orientation say what the screen is for; the
 * grid below says how to use it. The chords come from `shortcutTable()`, so it
 * cannot advertise a chord `commandForChord` does not accept — change a binding
 * in `keybindings.ts` and every cell here changes with it.
 */
function EmptyState() {
  const commands: WorkspaceCommand[] = [
    "quick-open",
    "split-right",
    "close-tab",
    "next-tab",
    "toggle-mode",
  ];
  const table = shortcutTable();
  return (
    <div className="pane-empty-state">
      <span className="pane-empty-mark" aria-hidden="true">
        <NavIcon name="pencil" />
      </span>
      <h3 className="pane-empty-title">Nothing open</h3>
      <p className="pane-empty-line">
        Pick a document on the left, or go straight to one by name. Your layout comes back when you
        return.
      </p>
      <dl className="pane-shortcuts">
        {commands.map((command) => (
          <div className="pane-shortcut" key={command}>
            <dt>
              {chordKeys(table[command]).map((key, index) => (
                <kbd key={`${command}-${index}`}>{key}</kbd>
              ))}
            </dt>
            <dd>{SHORTCUT_LABEL[command]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A printed chord split into its keycaps: `⌘⇥` is two caps, `⌘\` is two.
 *
 * The modifier glyphs are one character each and so is the key itself, so this
 * reads the modifier run and leaves the remainder as one cap — `⌘⇧⇥` is three
 * caps and `⌘\` is two, which is what a keycap grid wants.
 */
export function chordKeys(chord: string): string[] {
  const MODIFIERS = new Set(["⌘", "⇧", "⌥", "⌃"]);
  const caps: string[] = [];
  let index = 0;
  while (index < chord.length && MODIFIERS.has(chord[index]!)) {
    caps.push(chord[index]!);
    index += 1;
  }
  const rest = chord.slice(index);
  if (rest) caps.push(rest);
  return caps.length > 0 ? caps : [chord];
}

const SHORTCUT_LABEL: Record<WorkspaceCommand, string> = {
  "quick-open": "Go to file",
  "toggle-mode": "Edit / Read",
  "split-right": "Split right",
  "close-tab": "Close tab",
  "next-tab": "Next tab",
  "previous-tab": "Previous tab",
};

/** The tint class for a kind. `kind.ts` owns which tint a kind carries. */
function tintClass(kind: string): string {
  return kindTintClass(kind) ?? "";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function SplitGlyph({ direction }: { direction: "row" | "column" }) {
  // Two panes with the divider between them, drawn at the same weight as the
  // action set it replaces the two Unicode blocks of (`▥` and `▤`).
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "row" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 4v16" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 12h18" />
        </>
      )}
    </svg>
  );
}

/** Every tab open anywhere in the layout, deduplicated by document. */
export function openTabs(layout: PaneLayout): TabRef[] {
  const seen = new Set<string>();
  const out: TabRef[] = [];
  for (const leaf of leaves(layout.root)) {
    for (const tab of leaf.tabs) {
      if (seen.has(tabKey(tab))) continue;
      seen.add(tabKey(tab));
      out.push(tab);
    }
  }
  return out;
}
