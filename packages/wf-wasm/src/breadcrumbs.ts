/**
 * The path to the document on screen (Rust `editor_workspace::breadcrumbs`),
 * re-exported from index.ts.
 */
import { breadcrumbs as rawBreadcrumbs } from "../pkg/wf_wasm.js";

import type { BreadcrumbTab, Crumb, WorkspaceTreeNode } from "./bindings.js";

export type { BreadcrumbTab, Crumb };

/**
 * The crumbs for a document: the list it is in when it is in one, else its
 * folder. A document in neither gets its own title as one crumb.
 */
export function breadcrumbs(
  tab: BreadcrumbTab,
  files: readonly WorkspaceTreeNode[],
  lists: readonly WorkspaceTreeNode[] = [],
): Crumb[] {
  return rawBreadcrumbs(tab, files, lists);
}
