/**
 * What the explorer may create, rename and move, and where.
 *
 * The rules are per root: Notes takes notes, ink notes and folders (a folder
 * *is* a note with children); Report takes sections and nothing nested by
 * hand; Papers takes nothing — a paper arrives through import. They live here
 * as data rather than as conditions scattered through the panel, so the
 * panel asks one question per gesture and a test can read the table.
 */

import { ENTITY_DIRS } from "@weaveforge/core";

import { isDocumentNode, type WorkspaceTreeNode } from "./workspace-tree";

/** The kinds a draft row can make. */
export type CreateKind = "note" | "ink" | "folder" | "section";

/** Which root a row belongs to, or none for a list or outline row. */
export type EditableRoot = "notes" | "report";

const ROOT_KEYS: Record<EditableRoot, string> = {
  notes: ENTITY_DIRS.vault_page,
  report: ENTITY_DIRS.report_section,
};

const ROOT_OF_KIND: Record<string, EditableRoot> = {
  vault_page: "notes",
  ink_page: "notes",
  report_section: "report",
};

/** The kinds each root's rows may be given as children; the first is the default. */
const CREATABLE: Record<EditableRoot, readonly [CreateKind, ...CreateKind[]]> = {
  notes: ["note", "ink", "folder"],
  report: ["section"],
};

/** Where a "new file" lands when the document on screen belongs to no root. */
const DEFAULT_ROOT: EditableRoot = "notes";

/** The key of a root's row in the tree. */
export function rootKey(root: EditableRoot): string {
  return ROOT_KEYS[root];
}

/** A draft row: what it will make and where it sits. */
export interface Draft {
  kind: CreateKind;
  root: EditableRoot;
  /** The parent note or section; `null` puts it at the root. */
  parentId: string | null;
}

/** The root a row sits under, by its key or its kind. A list member is not editable. */
export function rootOf(node: Pick<WorkspaceTreeNode, "key" | "kind" | "isMember" | "headingLevel">): EditableRoot | null {
  if (node.isMember || node.headingLevel !== undefined) return null;
  if (node.key === ROOT_KEYS.notes) return "notes";
  if (node.key === ROOT_KEYS.report) return "report";
  return ROOT_OF_KIND[node.kind] ?? null;
}

/** The kinds a draft under `node` may take; empty for Papers, lists and headings. */
export function creatableUnder(node: Pick<WorkspaceTreeNode, "key" | "kind" | "isMember" | "headingLevel">): readonly CreateKind[] {
  const root = rootOf(node);
  return root ? CREATABLE[root] : [];
}

/** The root a *kind* belongs to — the kind-only half of `rootOf`. */
export function rootOfKind(kind: string): EditableRoot | null {
  return ROOT_OF_KIND[kind] ?? null;
}

/**
 * The kind the "new file" gestures make while `active` is the document on
 * screen: a note beside a note, a section beside a section, and Notes' own
 * first kind when the document lives under no editable root — a paper, a list,
 * or nothing at all.
 *
 * Read out of `CREATABLE` rather than written as a condition, so "what does
 * `⌘N` make here" has one answer per root and a root that gains a default kind
 * changes it in the table above.
 */
export function creationKindFor(active: { kind: string } | undefined): CreateKind {
  const root = active ? rootOfKind(active.kind) : null;
  return CREATABLE[root ?? DEFAULT_ROOT][0];
}

/** Whether a row can be renamed in place: any note or section, never a root or a paper. */
export function canRename(node: Pick<WorkspaceTreeNode, "key" | "kind" | "id" | "isMember" | "headingLevel">): boolean {
  return Boolean(node.id) && rootOf(node) !== null && isDocumentNode(node);
}

/**
 * Where a "new file" from the head or `⌘N` lands: the folder of the document
 * on screen when that document lives under a root that takes the kind,
 * otherwise the top of Notes (or of Report, for a section).
 *
 * Returns the parent id, `null` for the root, and which root — so the caller
 * knows whether the draft is a note or a section without a second lookup.
 */
export function creationTarget(
  kind: CreateKind,
  active: { kind: string; id: string; parentId?: string } | undefined,
): { root: EditableRoot; parentId: string | null } {
  const root: EditableRoot = kind === "section" ? "report" : "notes";
  if (active && ROOT_OF_KIND[active.kind] === root) {
    return { root, parentId: active.parentId ?? null };
  }
  return { root, parentId: null };
}

/**
 * Whether `source` may be dropped on `target`: same root, a real target (a
 * root row or a row of that root), and not the source itself or anything
 * beneath it — a drop there would loop the parent chain.
 */
export function canDrop(
  source: WorkspaceTreeNode,
  target: WorkspaceTreeNode,
): boolean {
  const root = rootOf(source);
  if (!root || !source.id || rootOf(target) !== root) return false;
  if (target.key === source.key) return false;
  if (isDocumentNode(target) && !target.id) return false;
  return !isDescendant(source, target);
}

/** The parent id a drop on `target` gives: `null` for the root row. */
export function dropParentId(target: WorkspaceTreeNode): string | null {
  return isDocumentNode(target) ? (target.id ?? null) : null;
}

function isDescendant(ancestor: WorkspaceTreeNode, node: WorkspaceTreeNode): boolean {
  for (const child of ancestor.children) {
    if (child.key === node.key || isDescendant(child, node)) return true;
  }
  return false;
}

/** The label a draft row's box shows as a hint. */
export function draftPlaceholder(kind: CreateKind): string {
  switch (kind) {
    case "note":
      return "Note title";
    case "ink":
      return "Ink note title";
    case "folder":
      return "Folder name";
    case "section":
      return "Section title";
  }
}

/**
 * The icon handle a draft row shows while it is being named.
 *
 * A draft is not a tree row yet, so it has no `kind.ts` row to ask; the handles
 * are the same ones the tree uses, which is what keeps the new row from looking
 * like a different species than the row it will become.
 */
const DRAFT_ICON: Record<CreateKind, string> = {
  note: "notes",
  ink: "ink",
  folder: "folder",
  section: "doc",
};

export function draftIcon(kind: CreateKind): string {
  return DRAFT_ICON[kind];
}

/**
 * What a draft of each kind turns into, for the two questions the screen asks
 * while making one: whether the note is handwritten, and whether it is opened
 * once it exists. A folder is neither — it is made and left closed, because
 * nobody writes into a folder.
 */
const DRAFT_MAKES: Record<CreateKind, { ink: boolean; opens: boolean }> = {
  note: { ink: false, opens: true },
  ink: { ink: true, opens: true },
  folder: { ink: false, opens: false },
  section: { ink: false, opens: true },
};

export function draftMakes(kind: CreateKind): { ink: boolean; opens: boolean } {
  return DRAFT_MAKES[kind];
}

/** The MIME type explorer rows drag as. */
export const EXPLORER_DRAG_TYPE = "application/x-weaveforge-node";
