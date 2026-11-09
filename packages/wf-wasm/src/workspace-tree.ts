/**
 * Explorer tree (Rust `editor_workspace::workspace_tree`), re-exported from index.ts.
 * The raw exports take and return arrays and plain objects; the Set and Map
 * results are built here.
 */
import {
  buildWorkspaceTree as rawBuildWorkspaceTree,
  flattenTree as rawFlattenTree,
  isDocumentNode as rawIsDocumentNode,
  folderIdsOf as rawFolderIdsOf,
  visibleRows as rawVisibleRows,
  slugSegment as rawSlugSegment,
  buildListsTree as rawBuildListsTree,
  listMembership as rawListMembership,
  filterRows as rawFilterRows,
} from "../pkg/wf_wasm.js";
import type {
  ListItemEntry,
  ListsTreeInput,
  VisibleRow,
  WorkspaceTreeInput,
  WorkspaceTreeNode,
} from "./bindings.js";

export function buildWorkspaceTree(input: WorkspaceTreeInput): WorkspaceTreeNode[] {
  return rawBuildWorkspaceTree(input) as WorkspaceTreeNode[];
}

export function flattenTree(nodes: readonly WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  return rawFlattenTree(nodes) as WorkspaceTreeNode[];
}

export function isDocumentNode(node: WorkspaceTreeNode): boolean {
  return rawIsDocumentNode(node);
}

export function folderIdsOf(nodes: readonly WorkspaceTreeNode[]): Set<string> {
  return new Set(rawFolderIdsOf(nodes) as string[]);
}

export function visibleRows(
  nodes: readonly WorkspaceTreeNode[],
  expanded: ReadonlySet<string>,
): VisibleRow[] {
  return rawVisibleRows(nodes, [...expanded]) as VisibleRow[];
}

export function slugSegment(title: string): string {
  return rawSlugSegment(title);
}

export function buildListsTree(input: ListsTreeInput): WorkspaceTreeNode[] {
  return rawBuildListsTree(input) as WorkspaceTreeNode[];
}

export function listMembership(
  items: readonly ListItemEntry[],
  titles: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const membership = rawListMembership(items, Object.fromEntries(titles)) as Record<string, string[]>;
  return new Map(Object.entries(membership));
}

export function filterRows(
  rows: readonly VisibleRow[],
  query: string,
): { rows: VisibleRow[]; expand: Set<string> } {
  const raw = rawFilterRows(rows, query) as { rows: VisibleRow[]; expand: string[] };
  return { rows: raw.rows, expand: new Set(raw.expand) };
}
