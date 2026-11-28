import { breadcrumbs } from "@weaveforge/wasm";
import type { TabRef, WorkspaceTreeNode } from "@weaveforge/wasm";

/** Breadcrumbs kept per document for one pair of trees: each call copies both trees into wasm, and panes ask on every render. */
export function crumbCache(tree: WorkspaceTreeNode[], listsTree: WorkspaceTreeNode[]) {
  const cache = new Map<string, ReturnType<typeof breadcrumbs>>();
  return (tab: TabRef) => {
    const key = `${tab.kind}\0${tab.id}`;
    let crumbs = cache.get(key);
    if (!crumbs) {
      crumbs = breadcrumbs({ kind: tab.kind, id: tab.id }, tree, listsTree);
      cache.set(key, crumbs);
    }
    return crumbs;
  };
}
