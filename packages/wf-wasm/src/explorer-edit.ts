/**
 * Explorer create, rename and move rules (Rust `editor_workspace::explorer_edit`),
 * re-exported from index.ts. The drag MIME type is a UI constant and lives with the panel.
 */
import {
  creatableUnder as rawCreatableUnder,
  creationKindFor as rawCreationKindFor,
  creationTarget as rawCreationTarget,
  dropParentId as rawDropParentId,
  rootOf as rawRootOf,
  rootOfKind as rawRootOfKind,
} from "../pkg/wf_wasm.js";

import type {
  CreateKind,
  CreationTarget,
  DraftMakes,
  EditableRoot,
  WorkspaceTreeNode,
} from "./bindings.js";

export {
  canDrop,
  canRename,
  draftIcon,
  draftMakes,
  draftPlaceholder,
  rootKey,
} from "../pkg/wf_wasm.js";

export type { CreateKind, DraftMakes, EditableRoot };

/** A draft row: what it will make and where it sits. */
export interface Draft {
  kind: CreateKind;
  root: EditableRoot;
  /** The parent note or section; `null` puts it at the root. */
  parentId: string | null;
}

/** The root a *kind* belongs to. */
export function rootOfKind(kind: string): EditableRoot | null {
  return rawRootOfKind(kind) ?? null;
}

/** The root a row sits under, or `null` for a list member or outline heading. */
export function rootOf(node: WorkspaceTreeNode): EditableRoot | null {
  return rawRootOf(node) ?? null;
}

/** The kinds a draft under `node` may take; empty when it holds nothing. */
export function creatableUnder(node: WorkspaceTreeNode): readonly CreateKind[] {
  return rawCreatableUnder(node);
}

/** The kind the "new file" gestures make for the document on screen. */
export function creationKindFor(active: { kind: string } | undefined): CreateKind {
  return rawCreationKindFor(active?.kind);
}

/** Where a "new file" lands: the folder of the document on screen, or the root. */
export function creationTarget(
  kind: CreateKind,
  active: { kind: string; id: string; parentId?: string } | undefined,
  folders: ReadonlySet<string>,
): CreationTarget {
  const doc = active ? { kind: active.kind, parentId: active.parentId ?? null } : null;
  return rawCreationTarget(kind, doc, [...folders]);
}

/** The parent id a drop on `target` gives: `null` for the root row. */
export function dropParentId(target: WorkspaceTreeNode): string | null {
  return rawDropParentId(target) ?? null;
}

