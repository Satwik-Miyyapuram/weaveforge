/**
 * The pane layout, across restarts.
 *
 * Stored per device next to the explorer's collapse state, and validated on the
 * way back in rather than trusted: the record outlives the version that wrote
 * it, and a layout is a recursive structure where one wrong field renders as a
 * blank workspace with no way back. Anything that does not parse is one empty
 * pane — which is exactly what a first run looks like, so the failure is
 * survivable rather than a dead screen.
 *
 * The parse is Rust's (`layoutFromRecord`); this module only reads and writes
 * the storage key.
 */

import type { KeyValueStore } from "./explorer-state";
import { emptyLayout, layoutFromRecord, type PaneLayout } from "@weaveforge/wasm";

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

export function readLayout(
  store: LayoutStore | undefined,
  projectId?: string | null,
): PaneLayout {
  if (!store) return emptyLayout();
  try {
    return layoutFromRecord(readRaw(store, projectId));
  } catch {
    return emptyLayout();
  }
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
