/**
 * Breadcrumbs: where the document on screen sits, as a path.
 *
 * The explorer collapses and the tab strip says only the title; the path must
 * not. Crumbs are read off the tree that already exists rather than fetched:
 * a row's ancestors *are* its path, and the tree is the same structure the
 * explorer paints, so a breadcrumb can never disagree with what the sidebar
 * shows.
 *
 * Reading lists are a view over Files, so a document that is a member of a list
 * gets crumbs that follow the *list* — that is the context the user is working
 * in when they opened it from there. Everything else follows the folder.
 */

import type { WorkspaceTreeNode } from "./workspace-tree";

export interface Crumb {
  label: string;
  /** Present when the crumb names a document that can be opened. */
  key?: string;
  /** Set on the final crumb, which is where the kind suffix is shown. */
  current?: boolean;
}

/** Find the first node with `kind:id`, depth-first. */
function findNode(nodes: readonly WorkspaceTreeNode[], kind: string, id: string): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.kind === kind && node.id === id) return node;
    const found = findNode(node.children, kind, id);
    if (found) return found;
  }
  return null;
}

/** The chain of nodes from a root down to `target`, inclusive. */
function chainTo(
  nodes: readonly WorkspaceTreeNode[],
  target: WorkspaceTreeNode,
): WorkspaceTreeNode[] | null {
  for (const node of nodes) {
    if (node.key === target.key) return [node];
    const below = chainTo(node.children, target);
    if (below) return [node, ...below];
  }
  return null;
}

/**
 * The crumbs for a document.
 *
 * A member row is only found under its list, and the list chain is what the
 * user was looking at, so the list path wins when the document is in a list.
 * A document that is in no list falls back to the folder path, and a document
 * that is in neither still gets its own title as a single crumb rather than an
 * empty strip.
 */
export function breadcrumbs(
  tab: { kind: string; id: string },
  files: readonly WorkspaceTreeNode[],
  lists: readonly WorkspaceTreeNode[] = [],
): Crumb[] {
  const inList = findNode(lists, tab.kind, tab.id);
  const target = inList ?? findNode(files, tab.kind, tab.id);
  if (!target) return [{ label: "Untitled", current: true }];

  const chain = chainTo(inList ? lists : files, target);
  if (!chain || chain.length === 0) return [{ label: target.label, current: true }];

  const crumbs: Crumb[] = [{ label: inList ? "Reading lists" : "Files" }];
  chain.forEach((node, index) => {
    const last = index === chain.length - 1;
    crumbs.push({
      label: node.label,
      ...(node.id ? { key: `${node.kind}:${node.id}` } : {}),
      ...(last ? { current: true } : {}),
    });
  });
  return crumbs;
}
