"use client";

import type { ReactNode } from "react";

import {
  activeTab,
  leaves,
  tabKey,
  type PaneLayout,
  type PaneLeaf,
  type PaneNode,
  type PaneSplit,
  type TabRef,
} from "../application/pane-tree";

export interface PaneActions {
  onActivate: (paneId: string, index: number) => void;
  onClose: (paneId: string, index: number) => void;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, direction: PaneSplit["direction"]) => void;
  onDropTab: (from: { paneId: string; index: number }, toPaneId: string) => void;
  onRatio: (split: PaneSplit, ratio: number) => void;
}

export interface PaneViewProps extends PaneActions {
  layout: PaneLayout;
  /** What a tab is called in its header — the entity's title, not its path. */
  labelFor: (tab: TabRef) => string;
  /** The editor for a tab. One call per open tab, not per visible tab. */
  renderDocument: (tab: TabRef) => ReactNode;
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
  onActivate,
  onClose,
  onFocus,
  onSplit,
  onDropTab,
}: PaneViewProps & { leaf: PaneLeaf }) {
  const focused = layout.focusedPaneId === leaf.id;
  const showing = activeTab(leaf);

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
        {leaf.tabs.map((tab, index) => (
          <div
            key={tabKey(tab)}
            role="tab"
            aria-selected={index === leaf.activeIndex}
            tabIndex={index === leaf.activeIndex ? 0 : -1}
            draggable
            onDragStart={(event) =>
              event.dataTransfer.setData("application/x-weaveforge-tab", `${leaf.id}|${index}`)
            }
            className={`pane-tab${index === leaf.activeIndex ? " is-active" : ""}`}
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
            <span className="pane-tab-label">{labelFor(tab)}</span>
            <button
              type="button"
              className="pane-tab-close"
              aria-label={`Close ${labelFor(tab)}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(leaf.id, index);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="pane-tab-actions">
          <button
            type="button"
            className="pane-action"
            aria-label="Split right"
            title="Split right"
            onClick={() => onSplit(leaf.id, "row")}
          >
            ▥
          </button>
          <button
            type="button"
            className="pane-action"
            aria-label="Split down"
            title="Split down"
            onClick={() => onSplit(leaf.id, "column")}
          >
            ▤
          </button>
        </div>
      </div>

      <div className="pane-body">
        {leaf.tabs.length === 0 ? (
          <p className="muted pane-empty">Pick something on the left to open it here.</p>
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
    </section>
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
