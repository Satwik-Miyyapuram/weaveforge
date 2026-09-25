/**
 * The explorer's tree, derived from entities that are already loaded.
 *
 * There is no separate "file" model here and there deliberately never will be.
 * A folder path is something `treePaths` computes from titles and parents, so
 * treating a path as identity would mean a rename moves a file and every open
 * tab points at nothing. The tree carries `{kind, id}` and the path only as the
 * label the user sees, which is also why a rename needs no tab bookkeeping.
 *
 * Four roots, because those are the things the desktop editor edits: notes (a
 * real tree), papers (flat, each with at most one note), the report (a tree of
 * sections), and the logbook (flat and dated).
 */

import {
  ENTITY_DIRS,
  KIND_SUFFIX,
  flatPath,
  logPath,
  treePaths,
  type FolderNode,
  type WorkspaceEntityType,
} from "@weaveforge/core";

/**
 * The entity kinds plus two of the tree's own: `folder` for a grouping row and
 * `paper_pdf` for a paper's PDF, which is a row and a tab but not a core entity.
 */
export type TreeNodeKind = WorkspaceEntityType | "folder" | "paper_pdf";

export interface WorkspaceTreeNode {
  /** Stable across renames — `${kind}:${id}` for entities, the path for roots. */
  key: string;
  kind: TreeNodeKind;
  /** Absent on a folder, which is a grouping rather than a document. */
  id?: string;
  label: string;
  /**
   * The entity's title where the row's label is not it: a paper's two files
   * are labelled `PDF` and `Notes` under the paper's row, and quick open
   * still lists and ranks them by the paper.
   */
  title?: string;
  /** The mirrored path, shown as a tooltip and matched by quick open. */
  path: string;
  children: WorkspaceTreeNode[];
  /**
   * A paper that has no note yet. It is still listed — the explorer offers
   * "Start note" rather than hiding the paper until one exists, because a paper
   * with no note is the normal state right after import.
   */
  missingNote?: boolean;
  /**
   * A row inside the Reading lists section: the same document seen through a
   * list. It renders dimmed and is not a second copy — its `kind` and `id` are
   * the entity's, so clicking it opens the same tab as clicking it under Files.
   */
  isMember?: boolean;
  /** Inherited from a parent list. Dimmer still, and not editable there. */
  inherited?: boolean;
  /** Where an inherited row came from, for the tooltip. */
  inheritedFrom?: string;
  /**
   * An Outline row: a heading of the document on screen, at this level. Such a
   * row has no `id` — it is not a document and opening it is meaningless, which
   * is why it is the one kind of row that scrolls a pane instead.
   */
  headingLevel?: number;
}

export interface PaperEntry {
  id: string;
  title: string;
  hasNote: boolean;
}

/**
 * A note in the tree, with the kind its body claims. An ink note sits among the
 * notes — same folder, same parent chain — and only its row and suffix differ.
 */
export interface NoteNode extends FolderNode {
  kind?: "vault_page" | "ink_page";
}

/**
 * A log entry in the tree.
 *
 * One field, not two: the row's label is its date. There is no separate title
 * to keep in step with the date it files under, which is the class of bug a
 * second field would invite — an entry filed under March while reading April.
 */
export interface LogEntry {
  id: string;
  entryDate: string;
}

export interface WorkspaceTreeInput {
  notes: readonly NoteNode[];
  papers: readonly PaperEntry[];
  reportSections: readonly FolderNode[];
  /**
   * The logbook, as documents. Optional so the six tests that build a tree out
   * of notes, papers and sections do not each have to say "and no log entries"
   * — the absence of a logbook and an empty logbook are the same tree, and the
   * screen that owns this one always passes it.
   */
  logEntries?: readonly LogEntry[];
}

const byLabel = (a: WorkspaceTreeNode, b: WorkspaceTreeNode) =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });

/** Build one root by nesting nodes under their parents, in `treePaths` order. */
function nestedRoot(
  label: string,
  type: WorkspaceEntityType,
  nodes: readonly NoteNode[],
): WorkspaceTreeNode {
  const paths = treePaths(nodes, type);
  const built = new Map<string, WorkspaceTreeNode>();
  for (const node of nodes) {
    const kind = node.kind ?? type;
    let path = paths.get(node.id) ?? ENTITY_DIRS[type];
    // An ink note mirrors as `.ink.md` in the same place a note would be.
    if (kind !== type) path = path.replace(/\.[a-z_]+\.md$/, `.${KIND_SUFFIX[kind]}.md`);
    built.set(node.id, {
      key: `${kind}:${node.id}`,
      kind,
      id: node.id,
      label: node.title.trim() || "Untitled",
      path,
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
  // A paper is two files under one row: its PDF and its notes. The row itself
  // is a grouping, so nothing can be made under it and neither file is hidden
  // behind a mode button. The files say what they are; the row says which
  // paper, so the two are told apart at a glance and the crumbs do not repeat.
  const papers: WorkspaceTreeNode[] = input.papers
    .map((paper) => {
      const label = paper.title.trim() || "Untitled";
      const notesPath = flatPath("paper", paper.id, paper.title);
      return {
        key: `papers/${paper.id}`,
        kind: "folder" as const,
        label,
        path: notesPath.replace(/\.paper\.md$/, ""),
        children: [
          {
            key: `paper_pdf:${paper.id}`,
            kind: "paper_pdf" as const,
            id: paper.id,
            label: "PDF",
            title: label,
            path: notesPath.replace(/\.paper\.md$/, ".pdf"),
            children: [],
          },
          {
            key: `paper:${paper.id}`,
            kind: "paper" as const,
            id: paper.id,
            label: "Notes",
            title: label,
            path: notesPath,
            children: [],
            ...(paper.hasNote ? {} : { missingNote: true }),
          },
        ],
      };
    })
    .sort(byLabel);

  // The logbook, newest first, as one flat root. Dated rows rather than a
  // title to sort by: the date is the name, so the label and the sort key are
  // the same string and an entry can never be filed under a month it is not in.
  const logEntries: WorkspaceTreeNode[] = (input.logEntries ?? [])
    .map((entry) => ({
      key: `log_entry:${entry.id}`,
      kind: "log_entry" as const,
      id: entry.id,
      label: entry.entryDate,
      path: logPath(entry.id, entry.entryDate),
      children: [],
    }))
    .sort((a, b) => b.label.localeCompare(a.label));

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
    {
      key: ENTITY_DIRS.log_entry,
      kind: "folder",
      label: "Log",
      path: ENTITY_DIRS.log_entry,
      children: logEntries,
    },
  ];
}

/** Every entity node, depth-first — what quick open searches over. */
export function flattenTree(nodes: readonly WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  const out: WorkspaceTreeNode[] = [];
  const walk = (node: WorkspaceTreeNode) => {
    // A member row of a reading list carries the entity's `kind`/`id` but a key
    // prefixed by its list, and it is the *same document* as the row under
    // Files. Without this guard a paper in four lists would be four palette
    // hits for one file.
    if (isDocumentNode(node) && !node.isMember) out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

/**
 * Whether a node is a document rather than a grouping row.
 *
 * This module owns the `folder` sentinel — it is the kind *this* file stamps on
 * the grouping rows it builds — so the question is answered here rather than by
 * a literal at each call site. It is deliberately not the same question as
 * `kind.ts`'s `isDocumentKind`, which answers for a kind string coming from a
 * tab or a palette row, and which has to know about ink's heading rows too.
 */
export function isDocumentNode(node: Pick<WorkspaceTreeNode, "kind">): boolean {
  return node.kind !== "folder";
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

/* -------------------------------------------------------------------------
 * Reading lists — §3.1
 * ---------------------------------------------------------------------- */

/** A reading list as the tree needs it. Ids and parents, nothing else. */
export interface ListEntry {
  id: string;
  title: string;
  parentId?: string;
  description?: string;
  slug?: string;
  parentSlug?: string;
}

/**
 * One membership row.
 *
 * `ReadingListItem` is the many-to-many join in core: each row is a paper *or*
 * a vault page, with an optional per-membership note. Inherited rows carry the
 * list they were inherited from, and a duplicate is the screening screen's
 * business rather than the explorer's.
 */
export interface ListItemEntry {
  listId: string;
  kind: "paper" | "vault_page";
  id: string;
  /** Overrides the entity's own title when the membership renamed it. */
  label?: string;
  inheritedFromListId?: string;
  duplicateOfItemId?: string;
}

export interface ListsTreeInput {
  lists: readonly ListEntry[];
  items: readonly ListItemEntry[];
  /** Titles for member rows. A row with no entry falls back to its id. */
  titles?: ReadonlyMap<string, string>;
  /**
   * The order member rows take, by kind. Passed in rather than decided here:
   * "papers before notes" is a per-kind presentation choice, so it lives in
   * `ui/kind.ts`'s table, and this module stays free of the UI layer.
   */
  memberRank?: (kind: string) => number;
}

/** The slug a title becomes in a mirrored path — the same rule everywhere. */
export function slugSegment(title: string): string {
  return title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "list";
}

/** The path a list file is mirrored to: `reading-lists/<parent>/<slug>.list.md`. */
export function listPath(list: ListEntry): string {
  const slug = list.slug ?? slugSegment(list.title);
  return list.parentSlug
    ? `reading-lists/${list.parentSlug}/${slug}.list.md`
    : `reading-lists/${slug}.list.md`;
}

/**
 * Build the Reading lists section.
 *
 * The section header *is* the "Lists" root — the lists sit at level one, with
 * no folder row above them. Members nest under the list they belong to, papers
 * first and then notes, each sorted by label.
 *
 * A member's key is prefixed by its list, so the same paper under two lists is
 * two rows with two keys — selection and expansion are per row. Its `kind` and
 * `id` are the entity's, so clicking it opens the same tab as clicking it under
 * Files. One document, several places in the tree; that is what a list is for.
 */
export function buildListsTree(input: ListsTreeInput): WorkspaceTreeNode[] {
  const titled = new Map(input.lists.map((list) => [list.id, list.title]));
  const listPathFor = (list: ListEntry): string => {
    // A nested list's path carries its parent's slug, which the caller may not
    // have computed. Deriving it from the parent's own path keeps the two in
    // step without a second pass.
    const parentSlug = list.parentId
      ? (list.parentSlug ?? slugSegment(titled.get(list.parentId) ?? ""))
      : undefined;
    return listPath({ ...list, parentSlug });
  };

  const lists: WorkspaceTreeNode[] = input.lists.map((list) => ({
    key: `reading_list:${list.id}`,
    kind: "reading_list",
    id: list.id,
    label: list.title.trim() || "Untitled list",
    path: listPathFor(list),
    children: [],
  }));
  const byId = new Map(input.lists.map((list, index) => [list.id, lists[index]!]));

  const roots: WorkspaceTreeNode[] = [];
  input.lists.forEach((list, index) => {
    const node = lists[index]!;
    const parent = list.parentId && list.parentId !== list.id ? byId.get(list.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  for (const node of byId.values()) node.children.sort(byLabel);
  roots.sort(byLabel);

  // Members are keyed by the entity so a title lookup works whether the row
  // came from a list membership or from the plain folder.
  const members = new Map<string, WorkspaceTreeNode[]>();
  for (const item of input.items) {
    if (item.duplicateOfItemId) continue; // screening's business, not the tree's
    const list = byId.get(item.listId);
    if (!list) continue;
    const entityKey = `${item.kind}:${item.id}`;
    const label = item.label?.trim() || input.titles?.get(entityKey)?.trim() || item.id;
    const row: WorkspaceTreeNode = {
      key: `reading_list:${item.listId}/${entityKey}`,
      kind: item.kind,
      id: item.id,
      label,
      // The member's own path, so the tooltip and the palette string are the
      // file's — not the list's.
      path: memberPath(item.kind, item.id, label),
      children: [],
      isMember: true,
      ...(item.inheritedFromListId
        ? {
            inherited: true,
            inheritedFrom: byId.get(item.inheritedFromListId)?.label ?? item.inheritedFromListId,
          }
        : {}),
    };
    members.set(item.listId, [...(members.get(item.listId) ?? []), row]);
  }

  for (const [listId, rows] of members) {
    const list = byId.get(listId);
    if (!list) continue;
    // Rank first (the caller's table says papers precede notes), then label —
    // so the ordering rule is data, not a comparison against `"paper"`.
    const rank = input.memberRank ?? (() => 0);
    const ordered = [...rows].sort(
      (a, b) => rank(a.kind) - rank(b.kind) || byLabel(a, b),
    );
    list.children.push(...ordered);
  }

  return roots;
}

function memberPath(kind: string, id: string, label: string): string {
  const dir = ENTITY_DIRS[kind as WorkspaceEntityType] ?? "notes";
  return `${dir}/${slugish(label)}--${id.slice(0, 6)}.md`;
}

function slugish(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "untitled";
}

/**
 * Which lists a document belongs to, for the "N lists" hint on a Files row.
 *
 * Membership should be discoverable without opening the second section, and the
 * answer is already here — no second query, no per-row fetch.
 */
export function listMembership(
  items: readonly ListItemEntry[],
  titles: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const item of items) {
    if (item.duplicateOfItemId) continue;
    const entityKey = `${item.kind}:${item.id}`;
    const listTitle = titles.get(`reading_list:${item.listId}`) ?? item.listId;
    out.set(entityKey, [...(out.get(entityKey) ?? []), listTitle]);
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Filtering
 * ---------------------------------------------------------------------- */

/**
 * The rows a filter leaves, and the keys that have to be open to show them.
 *
 * A filter that only hid rows would hide the *children* of a match too — typing
 * `.list` would show a list row with its papers still collapsed away. So a
 * match opens its own subtree, and the caller merges the returned keys with the
 * user's expansion set. An empty query returns the visible rows untouched and
 * opens nothing.
 */
export function filterRows(
  rows: readonly VisibleRow[],
  query: string,
): { rows: VisibleRow[]; expand: Set<string> } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { rows: [...rows], expand: new Set() };

  const matched = new Set<number>();
  rows.forEach((row, index) => {
    const haystack = `${row.node.label}\n${row.node.path}`.toLowerCase();
    if (haystack.includes(needle)) matched.add(index);
  });

  // A match opens its own subtree, so everything indented under a kept row is
  // kept too — otherwise a matching list would show with its papers still
  // collapsed away. One forward pass: a row directly under a kept branch is
  // deeper than that branch, and everything after it that is deeper still.
  const keep = new Set<number>();
  const expand = new Set<string>();
  let branchDepth = -1;
  rows.forEach((row, index) => {
    const matchedHere = matched.has(index);
    if (!matchedHere && branchDepth >= 0 && row.depth > branchDepth) {
      keep.add(index);
      return;
    }
    if (!matchedHere) {
      branchDepth = -1;
      return;
    }
    keep.add(index);
    expand.add(row.node.key);
    // Walk up to every ancestor, keeping and opening each one.
    let depth = row.depth;
    for (let i = index - 1; i >= 0 && depth > 0; i--) {
      if (rows[i]!.depth < depth) {
        keep.add(i);
        expand.add(rows[i]!.node.key);
        depth = rows[i]!.depth;
      }
    }
    branchDepth = row.depth;
  });

  return { rows: rows.filter((_row, index) => keep.has(index)), expand };
}
