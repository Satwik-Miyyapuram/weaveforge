/**
 * The explorer's tree, derived from entities that are already loaded.
 *
 * There is no separate "file" model here and there deliberately never will be.
 * A folder path is something `treePaths` computes from titles and parents, so
 * treating a path as identity would mean a rename moves a file and every open
 * tab points at nothing. The tree carries `{kind, id}` and the path only as the
 * label the user sees, which is also why a rename needs no tab bookkeeping.
 *
 * Three roots, because those are the three things the desktop editor edits:
 * notes (a real tree), papers (flat, each with at most one note), and the
 * report (a tree of sections).
 */

import {
  ENTITY_DIRS,
  flatPath,
  treePaths,
  type FolderNode,
  type WorkspaceEntityType,
} from "@weaveforge/core";

export type TreeNodeKind = WorkspaceEntityType | "folder";

export interface WorkspaceTreeNode {
  /** Stable across renames — `${kind}:${id}` for entities, the path for roots. */
  key: string;
  kind: TreeNodeKind;
  /** Absent on a folder, which is a grouping rather than a document. */
  id?: string;
  label: string;
  /** The mirrored path, shown as a tooltip and matched by quick open. */
  path: string;
  children: WorkspaceTreeNode[];
  /**
   * A paper that has no note yet. It is still listed — the explorer offers
   * "Start note" rather than hiding the paper until one exists, because a paper
   * with no note is the normal state right after import.
   */
  missingNote?: boolean;
}

export interface PaperEntry {
  id: string;
  title: string;
  hasNote: boolean;
}

export interface WorkspaceTreeInput {
  notes: readonly FolderNode[];
  papers: readonly PaperEntry[];
  reportSections: readonly FolderNode[];
}

const byLabel = (a: WorkspaceTreeNode, b: WorkspaceTreeNode) =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });

/** Build one root by nesting nodes under their parents, in `treePaths` order. */
function nestedRoot(
  label: string,
  type: WorkspaceEntityType,
  nodes: readonly FolderNode[],
): WorkspaceTreeNode {
  const paths = treePaths(nodes, type);
  const built = new Map<string, WorkspaceTreeNode>();
  for (const node of nodes) {
    built.set(node.id, {
      key: `${type}:${node.id}`,
      kind: type,
      id: node.id,
      label: node.title.trim() || "Untitled",
      path: paths.get(node.id) ?? ENTITY_DIRS[type],
      children: [],
    });
  }

  const roots: WorkspaceTreeNode[] = [];
  for (const node of nodes) {
    const built_ = built.get(node.id)!;
    // A parent that is missing — or that points at itself through a corrupted
    // chain — leaves the node at the root rather than dropping it from the tree.
    const parent = node.parentId && node.parentId !== node.id ? built.get(node.parentId) : undefined;
    if (parent) parent.children.push(built_);
    else roots.push(built_);
  }

  for (const node of built.values()) node.children.sort(byLabel);
  roots.sort(byLabel);
  return { key: ENTITY_DIRS[type], kind: "folder", label, path: ENTITY_DIRS[type], children: roots };
}

export function buildWorkspaceTree(input: WorkspaceTreeInput): WorkspaceTreeNode[] {
  const papers: WorkspaceTreeNode[] = input.papers
    .map((paper) => ({
      key: `paper:${paper.id}`,
      kind: "paper" as const,
      id: paper.id,
      label: paper.title.trim() || "Untitled",
      path: flatPath("paper", paper.id, paper.title),
      children: [],
      ...(paper.hasNote ? {} : { missingNote: true }),
    }))
    .sort(byLabel);

  return [
    nestedRoot("Notes", "vault_page", input.notes),
    {
      key: ENTITY_DIRS.paper,
      kind: "folder",
      label: "Papers",
      path: ENTITY_DIRS.paper,
      children: papers,
    },
    nestedRoot("Report", "report_section", input.reportSections),
  ];
}

/** Every entity node, depth-first — what quick open searches over. */
export function flattenTree(nodes: readonly WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  const out: WorkspaceTreeNode[] = [];
  const walk = (node: WorkspaceTreeNode) => {
    if (node.kind !== "folder") out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

export interface VisibleRow {
  node: WorkspaceTreeNode;
  depth: number;
}

/**
 * The rows the explorer actually paints, flattened with their indent.
 *
 * Keyboard navigation works on this list rather than on the tree: "down" means
 * the next visible row, which is a child when the row is open and a sibling
 * when it is not, and that is only obvious once the tree is flat.
 */
export function visibleRows(
  nodes: readonly WorkspaceTreeNode[],
  expanded: ReadonlySet<string>,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (node: WorkspaceTreeNode, depth: number) => {
    out.push({ node, depth });
    if (!expanded.has(node.key)) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const node of nodes) walk(node, 0);
  return out;
}
