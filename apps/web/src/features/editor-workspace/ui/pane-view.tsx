"use client";

import { Fragment, useState, type ReactNode } from "react";

import { NavIcon } from "@/app/nav-icon";
import { Select } from "@/components/select";
import { ToolbarSlotContext } from "@/components/toolbar-slot";
import type {
  Crumb,
  DocumentMode,
  PaneLayout,
  PaneLeaf,
  PaneNode,
  PaneSplit,
  TabMenuCommand,
  TabRef,
} from "@weaveforge/wasm";
import { type WorkspaceCommand } from "../application/parts";
import { readyCore } from "@/lib/rust-core";
import { openContextMenu } from "@/components/context-menu-store";
import type { MenuItem } from "@/components/menu";
import { Breadcrumbs } from "./breadcrumbs";
import { PaneModeSwitch, WorkspaceToolbar } from "./workspace-toolbar";
import { kindIcon, kindSuffix, kindTintClass } from "@weaveforge/wasm";
import { followPointer } from "./follow-pointer";
import { isMacPlatform } from "@/lib/parts";
import { TabButton } from "@/components/controls";
import { CloseButton } from "@/components/button";
import { DocumentPresence } from "@/features/collab";
import { groupLabel, groupMenuItems, TabGroupChip } from "./tab-group-chip";

export interface PaneActions {
  onActivate: (paneId: string, index: number) => void;
  onClose: (paneId: string, index: number) => void;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, direction: PaneSplit["direction"]) => void;
  /** Hide every piece of chrome around the document (`F11`). */
  onToggleFocus?: () => void;
  /** `toIndex` is set when the tab was dropped on another tab: it lands in that slot. */
  onDropTab: (from: { paneId: string; index: number }, toPaneId: string, toIndex?: number) => void;
  onRatio: (split: PaneSplit, ratio: number) => void;
  onSetMode: (tab: TabRef, mode: DocumentMode) => void;
  /** Split: open or close the preview of the focused document. */
  onTogglePreview: () => void;
  /** A tab's right-click item. */
  onTabMenu?: (paneId: string, index: number, command: TabMenuCommand) => void;
}

/** A tab's right-click menu, in VS Code's order. */
export function tabMenuItems(
  index: number,
  count: number,
  run: (command: TabMenuCommand) => void,
  leaf?: PaneLeaf,
): MenuItem[] {
  const groups = leaf ? groupMenuItems(leaf, index, run) : [];
  return [
    { id: "close", label: "Close", accelerator: readyCore().keyLabel("Mod-w", isMacPlatform()), onSelect: () => run("close") },
    { id: "close-others", label: "Close others", disabled: count < 2, onSelect: () => run("close-others") },
    {
      id: "close-right",
      label: "Close to the right",
      disabled: index >= count - 1,
      onSelect: () => run("close-right"),
    },
    { id: "sep", label: "", kind: "separator" },
    { id: "split-right", label: "Split right", onSelect: () => run("split-right") },
    { id: "split-down", label: "Split down", onSelect: () => run("split-down") },
    ...groups,
  ];
}

export interface PaneViewProps extends PaneActions {
  layout: PaneLayout;
  /** Focus mode: the toolbar is hidden, so each document keeps its own bar. */
  focus?: boolean;
  /** What a tab is called in its header — the entity's title, not its path. */
  labelFor: (tab: TabRef) => string;
  /** The editor for a tab. One call per open tab, not per visible tab. */
  renderDocument: (tab: TabRef) => ReactNode;
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
const TAB_DRAG_TYPE = "application/x-weaveforge-tab";

/** The tab being dragged, written as `paneId|index` when the drag started. */
function draggedTab(data: DataTransfer): { paneId: string; index: number } | null {
  const [paneId, index] = data.getData(TAB_DRAG_TYPE).split("|");
  return paneId && index ? { paneId, index: Number(index) } : null;
}

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
            props.onRatio(split, (split.ratio ?? 0.5) + step);
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
      <div className="pane-half" style={{ flex: `${1 - (split.ratio ?? 0.5)} 1 0` }}>
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
  crumbsFor,
  onOpenCrumb,
  onActivate,
  onClose,
  onFocus,
  onDropTab,
  onSetMode,
  onTabMenu,
  focus,
  slot,
}: TreeProps & { leaf: PaneLeaf }) {
  const focused = layout.focusedPaneId === leaf.id;
  const showing = readyCore().activeTab(leaf);
  const crumbs = showing ? (crumbsFor?.(showing) ?? []) : [];
  const runs = readyCore().groupRuns(leaf);

  return (
    <section
      className={`pane${focused ? " is-focused" : ""}`}
      onFocusCapture={() => onFocus(leaf.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const from = draggedTab(event.dataTransfer);
        if (from) onDropTab(from, leaf.id);
      }}
    >
      {/* Two columns: the tabs scroll, the actions stay put. */}
      <div className="pane-tabs">
        <div className="pane-tab-scroll" role="tablist" aria-label="Open documents">
        {leaf.tabs.map((tab, index) => {
          const isActive = index === leaf.activeIndex;
          const suffix = kindSuffix(tab.kind);
          const run = runs[index]!;
          const group = leaf.groups?.find((g) => g.id === tab.group);
          return (
            <Fragment key={readyCore().tabKey(tab)}>
              {run.chip ? (
                <TabGroupChip
                  group={run.chip}
                  label={groupLabel(leaf, run.chip)}
                  size={run.size}
                  run={(command) => onTabMenu?.(leaf.id, index, command)}
                />
              ) : null}
              <div
                className="pane-tab-slot"
                role="presentation"
                data-tag-tone={group?.color}
                hidden={run.hidden}
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData(TAB_DRAG_TYPE, `${leaf.id}|${index}`)
                }
                onDrop={(event) => {
                  const from = draggedTab(event.dataTransfer);
                  if (!from) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onDropTab(from, leaf.id, index);
                }}
                onAuxClick={(event) => {
                  // Middle-click closes, as every tabbed editor does.
                  if (event.button === 1) onClose(leaf.id, index);
                }}
                onContextMenu={(event) => {
                  if (!onTabMenu) return;
                  openContextMenu(
                    event,
                    tabMenuItems(index, leaf.tabs.length, (command) => onTabMenu(leaf.id, index, command), leaf),
                  );
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
            </Fragment>
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
                <option key={readyCore().tabKey(tab)} value={index}>
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
          {/* Presence belongs in the chrome, not inside the document. */}
          {showing ? <DocumentPresence docKey={`${showing.kind}:${showing.id}`} /> : null}
        </div>
      </div>

      {/* The explorer collapses and the tab strip says only the title; the path
          must not. The last crumb carries the kind suffix, because there the
          crumb *is* the path. */}
      {showing ? (
        <div className="pane-crumbs">
          <Breadcrumbs crumbs={crumbs} kind={showing.kind} onOpen={onOpenCrumb} />
          {/* In Ink the mode switch lives here, in the note, not in the toolbar. */}
          {!focus && !readyCore().isPreviewTab(showing) && showing.kind !== "overleaf" ? (
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
              const shown = showing !== undefined && readyCore().tabKey(tab) === readyCore().tabKey(showing);
              // Hidden rather than unmounted: an editor that unmounts loses its
              // scroll position, its undo history and its live binding.
              return (
                <div key={readyCore().tabKey(tab)} className="pane-document" hidden={!shown}>
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
 * grid below says how to use it. The chords come from `readyCore().shortcutTable()`, so it
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
      <ShortcutGrid commands={commands} />
    </div>
  );
}

/** Keycaps beside a label, one row per command; the empty state and the `⌘/` sheet share it. */
export function ShortcutGrid({ commands }: { commands: readonly WorkspaceCommand[] }) {
  const table = readyCore().shortcutTable();
  return (
    <dl className="pane-shortcuts">
      {commands.map((command) => (
        <div className="pane-shortcut" key={command}>
          <dt>
            {chordKeys(table[command]).map((key, index) => (
              <kbd key={`${command}-${index}`}>{readyCore().keyLabel(key, isMacPlatform())}</kbd>
            ))}
          </dt>
          <dd>{SHORTCUT_LABEL[command]}</dd>
        </div>
      ))}
    </dl>
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
  "show-shortcuts": "Keyboard shortcuts",
  "reopen-tab": "Reopen closed tab",
  "rename-doc": "Rename document",
  "toggle-sidebar": "Hide / show sidebar",
  "duplicate-note": "Duplicate note",
  "command-palette": "Commands",
  "workspace-search": "Search workspace",
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


/** Every tab open anywhere in the layout, deduplicated by document. */
export function openTabs(layout: PaneLayout): TabRef[] {
  const seen = new Set<string>();
  const out: TabRef[] = [];
  for (const leaf of readyCore().leaves(layout.root)) {
    for (const tab of leaf.tabs) {
      if (seen.has(readyCore().tabKey(tab))) continue;
      seen.add(readyCore().tabKey(tab));
      out.push(tab);
    }
  }
  return out;
}
