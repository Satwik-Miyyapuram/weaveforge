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
import { emptyLayout, type PaneLayout, type PaneNode } from "./pane-tree";

export const LAYOUT_STORAGE_KEY = "weaveforge.editor.layout";

function parseNode(value: unknown): PaneNode | null {
  if (typeof value !== "object" || value === null) return null;
  const node = value as Record<string, unknown>;

  if (node.type === "leaf") {
    if (typeof node.id !== "string" || !Array.isArray(node.tabs)) return null;
    const tabs = node.tabs.filter(
      (tab): tab is { kind: string; id: string } =>
        typeof tab === "object" &&
        tab !== null &&
        typeof (tab as { kind?: unknown }).kind === "string" &&
        typeof (tab as { id?: unknown }).id === "string",
    );
    const activeIndex = typeof node.activeIndex === "number" ? node.activeIndex : 0;
    return {
      type: "leaf",
      id: node.id,
      tabs: tabs.map((tab) => ({ kind: tab.kind, id: tab.id })),
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

export function readLayout(store: KeyValueStore | undefined): PaneLayout {
  if (!store) return emptyLayout();
  try {
    const raw = store.getItem(LAYOUT_STORAGE_KEY);
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

export function writeLayout(store: KeyValueStore | undefined, layout: PaneLayout): void {
  try {
    store?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage disabled. The layout still holds for this session.
  }
}
