/**
 * Pane layout (Rust `editor_workspace::pane_tree`), re-exported from index.ts.
 * The app's call shapes are kept here: callbacks become key lists, and new
 * pane ids are generated in this glue, since the raw exports take them as input.
 */
import {
  tabKey as rawTabKey,
  leaves as rawLeaves,
  openTab as rawOpenTab,
  splitPane as rawSplitPane,
  moveTab as rawMoveTab,
  activeTab as rawActiveTab,
  activeTabRef as rawActiveTabRef,
  activeTabKey as rawActiveTabKey,
  tabAt as rawTabAt,
  togglePreview as rawTogglePreview,
  previewSource as rawPreviewSource,
  openTabKeys as rawOpenTabKeys,
  commandForChord as rawCommandForChord,
  layoutForCommand as rawLayoutForCommand,
  layoutForTabMenu as rawLayoutForTabMenu,
  pruneLayout as rawPruneLayout,
  hydrateTabModes as rawHydrateTabModes,
} from "../pkg/wf_wasm.js";
import type {
  DocumentMode,
  KeyChord,
  PaneCommand,
  PaneLayout,
  PaneLeaf,
  SplitDirection,
  TabMenuCommand,
  TabRef,
} from "./bindings.js";

export {
  activateTab,
  closeTab,
  closedTabs,
  emptyLayout,
  focusPane,
  focusedTabCount,
  layoutFromRecord,
  leaves,
  previewOpen,
  previewTab,
  setRatio,
  setTabMode,
  tabKey,
  tabMode,
} from "../pkg/wf_wasm.js";

/** Kind of the preview tab (Rust `PREVIEW_KIND`). */
const PREVIEW_KIND = "preview";

let paneCounter = 0;
/** A pane id unique within this session; the glue passes it to the raw calls that create panes. */
function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${Date.now().toString(36)}-${paneCounter}`;
}

/** True for the preview tab, which is one tab not tied to a document. */
export function isPreviewTab(tab?: TabRef): boolean {
  return tab?.kind === PREVIEW_KIND;
}

export function openTab(layout: PaneLayout, tab: TabRef, paneId = layout.focusedPaneId): PaneLayout {
  return rawOpenTab(layout, tab, paneId) as PaneLayout;
}

export function splitPane(
  layout: PaneLayout,
  paneId: string,
  direction: SplitDirection,
  newPaneId = nextPaneId(),
): PaneLayout {
  return rawSplitPane(layout, paneId, direction, newPaneId) as PaneLayout;
}

/** Move a tab; `toIndex` is the slot on a tab drop, or omitted to append on a pane drop. */
export function moveTab(
  layout: PaneLayout,
  from: { paneId: string; index: number },
  toPaneId: string,
  toIndex?: number,
): PaneLayout {
  return rawMoveTab(layout, from.paneId, from.index, toPaneId, toIndex) as PaneLayout;
}

export function activeTab(leaf: PaneLeaf): TabRef | undefined {
  return (rawActiveTab(leaf) ?? undefined) as TabRef | undefined;
}

export function activeTabRef(layout: PaneLayout): TabRef | undefined {
  return (rawActiveTabRef(layout) ?? undefined) as TabRef | undefined;
}

export function activeTabKey(layout: PaneLayout): string | undefined {
  return rawActiveTabKey(layout) ?? undefined;
}

export function tabAt(layout: PaneLayout, paneId: string, index: number): TabRef | undefined {
  return (rawTabAt(layout, paneId, index) ?? undefined) as TabRef | undefined;
}

export function togglePreview(layout: PaneLayout, newPaneId = nextPaneId()): PaneLayout {
  return rawTogglePreview(layout, newPaneId) as PaneLayout;
}

/** The document the preview shows: the focused tab, or `previous` when the focus is on the preview itself. */
export function previewSource(layout: PaneLayout, previous?: TabRef): TabRef | undefined {
  return (rawPreviewSource(layout, previous) ?? undefined) as TabRef | undefined;
}

/** The key of every tab open in any pane. */
export function openTabKeys(layout: PaneLayout): Set<string> {
  return new Set(rawOpenTabKeys(layout) as string[]);
}

/** The fields of a key press that a chord reads (a DOM `KeyboardEvent` also fits). */
export type { KeyChord };

/**
 * The workspace command a chord means (Rust `keybindings::command_for_chord`).
 * The fields are copied out first: a DOM event keeps its modifiers on prototype getters.
 * `tabCount` defaults to unbounded.
 */
export function commandForChord(chord: KeyChord, tabCount = Infinity): string | null {
  const plain = {
    key: chord.key,
    code: chord.code ?? null,
    ctrlKey: chord.ctrlKey ?? false,
    metaKey: chord.metaKey ?? false,
    shiftKey: chord.shiftKey ?? false,
    altKey: chord.altKey ?? false,
  };
  const count = Number.isFinite(tabCount) ? tabCount : undefined;
  return (rawCommandForChord(plain, count) ?? null) as string | null;
}

export function layoutForCommand(
  layout: PaneLayout,
  command: PaneCommand,
  newPaneId = nextPaneId(),
): PaneLayout {
  return sameOr(layout, rawLayoutForCommand(layout, command, newPaneId) as PaneLayout);
}

export function layoutForTabMenu(
  layout: PaneLayout,
  paneId: string,
  index: number,
  command: TabMenuCommand,
  newPaneId = nextPaneId(),
): PaneLayout {
  return sameOr(layout, rawLayoutForTabMenu(layout, paneId, index, command, newPaneId) as PaneLayout);
}

/** `before` itself when Rust returned an equal layout, so `next === layout` means "no change". */
function sameOr(before: PaneLayout, after: PaneLayout): PaneLayout {
  return JSON.stringify(before) === JSON.stringify(after) ? before : after;
}

/**
 * Drop tabs for which `exists` is false, then collapse whatever that empties.
 * Preview tabs are always kept, as the raw call does.
 */
export function pruneLayout(layout: PaneLayout, exists: (tab: TabRef) => boolean): PaneLayout {
  const open = new Set<string>();
  for (const leaf of rawLeaves(layout.root) as PaneLeaf[]) {
    for (const tab of leaf.tabs) {
      if (exists(tab)) open.add(rawTabKey(tab));
    }
  }
  return rawPruneLayout(layout, [...open]) as PaneLayout;
}

/**
 * Stamp `modeFor(tab)` onto every tab that has no mode yet. A tab that already
 * carries a mode is left alone. Returns `layout` itself when nothing changes.
 */
export function hydrateTabModes(
  layout: PaneLayout,
  modeFor: (tab: TabRef) => DocumentMode,
): PaneLayout {
  const modes: Record<string, DocumentMode> = {};
  for (const leaf of rawLeaves(layout.root) as PaneLeaf[]) {
    for (const tab of leaf.tabs) {
      if (tab.mode == null) modes[rawTabKey(tab)] = modeFor(tab);
    }
  }
  if (Object.keys(modes).length === 0) return layout;
  return rawHydrateTabModes(layout, modes) as PaneLayout;
}
