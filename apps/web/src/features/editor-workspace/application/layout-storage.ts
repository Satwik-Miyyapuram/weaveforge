/**
 * The pane layout, across restarts.
 *
 * Stored per device next to the explorer's collapse state, and validated on the
 * way back in rather than trusted: the record outlives the version that wrote
 * it, and a layout is a recursive structure where one wrong field renders as a
 * blank workspace with no way back. Anything that does not parse is one empty
 * pane — which is exactly what a first run looks like, so the failure is
 * survivable rather than a dead screen.
 */

import type { KeyValueStore } from "./explorer-state";
import { emptyLayout, type DocumentMode, type PaneLayout, type PaneNode, type TabRef } from "./pane-tree";

export const LAYOUT_STORAGE_KEY = "weaveforge.editor.layout";

/** Storage that can also forget a key; `localStorage` is one. */
type LayoutStore = KeyValueStore & { removeItem?: (key: string) => void };

/**
 * Each project keeps its own panes: a tab from project A restored into
 * project B is a document B cannot open. No project means the plain key.
 */
function layoutKey(projectId: string | null | undefined): string {
  return projectId ? `${LAYOUT_STORAGE_KEY}.${projectId}` : LAYOUT_STORAGE_KEY;
}

/**
 * The raw record for a project. Layouts saved before they were per project
 * sit under the plain key: the first project opened adopts that record and
 * the plain key is cleared, so no second project inherits the same tabs.
 */
function readRaw(store: LayoutStore, projectId: string | null | undefined): string | null {
  const key = layoutKey(projectId);
  const own = store.getItem(key);
  if (own || key === LAYOUT_STORAGE_KEY) return own;
  const legacy = store.getItem(LAYOUT_STORAGE_KEY);
  if (!legacy) return null;
  store.setItem(key, legacy);
  store.removeItem?.(LAYOUT_STORAGE_KEY);
  return legacy;
}

const MODES: readonly string[] = ["edit", "read", "pdf", "ink"] satisfies readonly DocumentMode[];

/** A tab as stored. A missing or unknown mode reads as none chosen yet. */
function parseTab(tab: { kind: string; id: string; mode?: unknown }): TabRef {
  return typeof tab.mode === "string" && MODES.includes(tab.mode)
    ? { kind: tab.kind, id: tab.id, mode: tab.mode as DocumentMode }
    : { kind: tab.kind, id: tab.id };
}

function parseNode(value: unknown): PaneNode | null {
  if (typeof value !== "object" || value === null) return null;
  const node = value as Record<string, unknown>;

  if (node.type === "leaf") {
    if (typeof node.id !== "string" || !Array.isArray(node.tabs)) return null;
    const tabs = node.tabs.filter(
      (tab): tab is { kind: string; id: string; mode?: unknown } =>
        typeof tab === "object" &&
        tab !== null &&
        typeof (tab as { kind?: unknown }).kind === "string" &&
        typeof (tab as { id?: unknown }).id === "string",
    );
    const activeIndex = typeof node.activeIndex === "number" ? node.activeIndex : 0;
    return {
      type: "leaf",
      id: node.id,
      tabs: tabs.map(parseTab),
      activeIndex: Math.min(Math.max(activeIndex, 0), Math.max(tabs.length - 1, 0)),
    };
  }

  if (node.type === "split") {
    if (!Array.isArray(node.children) || node.children.length !== 2) return null;
    const first = parseNode(node.children[0]);
    const second = parseNode(node.children[1]);
    // Half a split is not half a workspace: keep whichever side survived.
    if (!first) return second;
    if (!second) return first;
    const ratio = typeof node.ratio === "number" && Number.isFinite(node.ratio) ? node.ratio : 0.5;
    return {
      type: "split",
      direction: node.direction === "column" ? "column" : "row",
      ratio: Math.min(Math.max(ratio, 0.1), 0.9),
      children: [first, second],
    };
  }

  return null;
}

export function readLayout(
  store: LayoutStore | undefined,
  projectId?: string | null,
): PaneLayout {
  if (!store) return emptyLayout();
  try {
    const raw = readRaw(store, projectId);
    if (!raw) return emptyLayout();
    const parsed = JSON.parse(raw) as { root?: unknown; focusedPaneId?: unknown };
    const root = parseNode(parsed.root);
    if (!root) return emptyLayout();
    const focused = typeof parsed.focusedPaneId === "string" ? parsed.focusedPaneId : "";
    // `settleFocus` runs on every operation, so a focus id that no longer
    // matches a pane is corrected by the first thing the user does.
    return { root, focusedPaneId: focused || firstLeafId(root) };
  } catch {
    return emptyLayout();
  }
}

function firstLeafId(node: PaneNode): string {
  return node.type === "leaf" ? node.id : firstLeafId(node.children[0]);
}

export function writeLayout(
  store: KeyValueStore | undefined,
  layout: PaneLayout,
  projectId?: string | null,
): void {
  try {
    store?.setItem(layoutKey(projectId), JSON.stringify(layout));
  } catch {
    // Storage disabled. The layout still holds for this session.
  }
}
