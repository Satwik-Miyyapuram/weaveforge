"use client";

import { useState, type ReactNode } from "react";

import { NavIcon } from "@/app/nav-icon";
import { Select } from "@/components/select";
import { ToolbarSlotContext } from "@/components/toolbar-slot";
import type { Crumb } from "../application/breadcrumbs";
import { shortcutTable, type WorkspaceCommand } from "../application/keybindings";
import {
  activeTab,
  isPreviewTab,
  leaves,
  tabKey,
  type DocumentMode,
  type PaneLayout,
  type PaneLeaf,
  type PaneNode,
  type PaneSplit,
  type TabRef,
} from "../application/pane-tree";
import { Breadcrumbs } from "./breadcrumbs";
import { PaneModeSwitch, WorkspaceToolbar } from "./workspace-toolbar";
import { kindIcon, kindSuffix, kindTintClass } from "./kind";
import { followPointer } from "./follow-pointer";
import { keyLabel } from "@/lib/shortcut-label";
import { TabButton } from "@/components/controls";
import { CloseButton } from "@/components/button";

export interface PaneActions {
  onActivate: (paneId: string, index: number) => void;
  onClose: (paneId: string, index: number) => void;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, direction: PaneSplit["direction"]) => void;
  /** Hide every piece of chrome around the document (`⌘⇧F`). */
  onToggleFocus?: () => void;
  onDropTab: (from: { paneId: string; index: number }, toPaneId: string) => void;
  onRatio: (split: PaneSplit, ratio: number) => void;
  onSetMode: (tab: TabRef, mode: DocumentMode) => void;
  /** Split: open or close the preview of the focused document. */
  onTogglePreview: () => void;
}

export interface PaneViewProps extends PaneActions {
  layout: PaneLayout;
  /** Focus mode: the toolbar is hidden, so each document keeps its own bar. */
  focus?: boolean;
  /** What a tab is called in its header — the entity's title, not its path. */
  labelFor: (tab: TabRef) => string;
  /** The editor for a tab. One call per open tab, not per visible tab. */
  renderDocument: (tab: TabRef) => ReactNode;
  /** Editors this tab is live in. Rendered as avatars at the right of the strip. */
  peers?: (tab: TabRef) => readonly string[];
  /** The path to a document, for the strip above the pane. */
  crumbsFor?: (tab: TabRef) => readonly Crumb[];
  /** A crumb click: open the document the crumb names. */
  onOpenCrumb?: (crumb: Crumb) => void;
  /** Insert a picture from disk into the focused document (Text only). */
  onInsertImage?: (tab: TabRef, file: File) => void;
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
  // The toolbar's document slot, where the focused document puts its own tools.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="pane-root">
      <WorkspaceToolbar
        slotRef={setSlot}
        layout={props.layout}
        onInsertImage={props.onInsertImage}
        onTogglePreview={props.onTogglePreview}
        onSplit={props.onSplit}
        onToggleFocus={props.onToggleFocus}
      />
      <div className="pane-stage">
        <PaneNodeView node={props.layout.root} {...props} slot={slot} />
      </div>
    </div>
  );
}

type TreeProps = PaneViewProps & { slot: HTMLElement | null };

function PaneNodeView({ node, ...props }: TreeProps & { node: PaneNode }) {
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
          followPointer(window, move);
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
  onOpenCrumb,
  onActivate,
  onClose,
  onFocus,
  onDropTab,
  onSetMode,
  focus,
  slot,
}: TreeProps & { leaf: PaneLeaf }) {
  const focused = layout.focusedPaneId === leaf.id;
  const showing = activeTab(leaf);
  const peerNames = showing ? (peers?.(showing) ?? []) : [];
  const crumbs = showing ? (crumbsFor?.(showing) ?? []) : [];

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
      {/* Two columns: the tabs scroll, the actions stay put. */}
      <div className="pane-tabs">
        <div className="pane-tab-scroll" role="tablist" aria-label="Open documents">
        {leaf.tabs.map((tab, index) => {
          const isActive = index === leaf.activeIndex;
          const suffix = kindSuffix(tab.kind);
          return (
            <div
              key={tabKey(tab)}
              className="pane-tab-slot"
              role="presentation"
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData("application/x-weaveforge-tab", `${leaf.id}|${index}`)
              }
              onAuxClick={(event) => {
                // Middle-click closes, as every tabbed editor does.
                if (event.button === 1) onClose(leaf.id, index);
              }}
            >
              <TabButton
                selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onActivate(leaf.id, index)}
              >
                <span className={`pane-tab-icon ${tintClass(tab.kind)}`} aria-hidden="true">
                  <NavIcon name={kindIcon(tab.kind)} />
                </span>
                <span className="pane-tab-label">{labelFor(tab)}</span>
                {suffix ? <span className="pane-tab-ext">{suffix}</span> : null}
              </TabButton>
              <CloseButton size="sm" label={`Close ${labelFor(tab)}`} onClick={() => onClose(leaf.id, index)} />
            </div>
          );
        })}
        </div>
        {/* Below 480px the strip fits about one and a half titles, so it gives
            way to one control naming the document on screen; its menu lists
            every title in full. */}
        {showing ? (
          <div className="pane-tab-switcher">
            <span className={`pane-tab-icon ${tintClass(showing.kind)}`} aria-hidden="true">
              <NavIcon name={kindIcon(showing.kind)} />
            </span>
            <Select
              className="pane-tab-select"
              aria-label="Open documents"
              value={String(leaf.activeIndex)}
              onChange={(event) => onActivate(leaf.id, Number(event.target.value))}
            >
              {leaf.tabs.map((tab, index) => (
                <option key={tabKey(tab)} value={index}>
                  {labelFor(tab)}
                </option>
              ))}
            </Select>
            {leaf.tabs.length > 1 ? (
              <span className="pane-tab-count" aria-hidden="true">{leaf.tabs.length}</span>
            ) : null}
            <CloseButton size="sm" label={`Close ${labelFor(showing)}`} onClick={() => onClose(leaf.id, leaf.activeIndex)} />
          </div>
        ) : null}
        <div className="pane-tab-actions">
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
        </div>
      </div>

      {/* The explorer collapses and the tab strip says only the title; the path
          must not. The last crumb carries the kind suffix, because there the
          crumb *is* the path. */}
      {showing ? (
        <div className="pane-crumbs">
          <Breadcrumbs crumbs={crumbs} kind={showing.kind} onOpen={onOpenCrumb} />
          {/* In Ink the mode switch lives here, in the note, not in the toolbar. */}
          {!focus && !isPreviewTab(showing) ? (
            <PaneModeSwitch tab={showing} onSetMode={onSetMode} />
          ) : null}
        </div>
      ) : null}

      <div className="pane-body-wrap">
        <div className="pane-body">
          {leaf.tabs.length === 0 ? (
            <EmptyState />
          ) : (
            leaf.tabs.map((tab) => {
              const shown = showing !== undefined && tabKey(tab) === tabKey(showing);
              // Hidden rather than unmounted: an editor that unmounts loses its
              // scroll position, its undo history and its live binding.
              return (
                <div key={tabKey(tab)} className="pane-document" hidden={!shown}>
                  <ToolbarSlotContext.Provider value={focus ? undefined : focused && shown ? slot : null}>
                    {renderDocument(tab)}
                  </ToolbarSlotContext.Provider>
                </div>
              );
            })
          )}
        </div>
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
    "new-note",
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
                <kbd key={`${command}-${index}`}>{keyLabel(key)}</kbd>
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
  "new-note": "New note",
  "toggle-explorer": "Hide / show explorer",
  "toggle-focus": "Focus: document only",
  "toggle-mode": "Preview",
  "split-right": "Split right",
  "close-tab": "Close tab",
  "next-tab": "Next tab",
  "previous-tab": "Previous tab",
  "tab-1": "Tab 1",
  "tab-2": "Tab 2",
  "tab-3": "Tab 3",
  "tab-4": "Tab 4",
  "tab-5": "Tab 5",
  "tab-6": "Tab 6",
  "tab-7": "Tab 7",
  "tab-8": "Tab 8",
  "last-tab": "Last tab",
};

/** The tint class for a kind. `kind.ts` owns which tint a kind carries. */
function tintClass(kind: string): string {
  return kindTintClass(kind) ?? "";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
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
