/**
 * Tab groups (Rust `editor_workspace::tab_groups`), re-exported from index.ts.
 */
import {
  withoutGroup as rawWithoutGroup,
  cleanGroups as rawCleanGroups,
  applyGroupCommand as rawApplyGroupCommand,
  groupRuns as rawGroupRuns,
} from "../pkg/wf_wasm.js";
import type { PaneLeaf, TabGroupCommand, TabRef, TabRun } from "./bindings.js";

/** The colours a group can take (Rust `GROUP_COLORS`). */
export const GROUP_COLORS = [1, 2, 3, 4, 5, 6] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export function withoutGroup(tab: TabRef): TabRef {
  return rawWithoutGroup(tab) as TabRef;
}

export function cleanGroups(leaf: PaneLeaf): PaneLeaf {
  return rawCleanGroups(leaf) as PaneLeaf;
}

export function applyGroupCommand(leaf: PaneLeaf, index: number, command: TabGroupCommand): PaneLeaf {
  return rawApplyGroupCommand(leaf, index, command) as PaneLeaf;
}

export function groupRuns(leaf: PaneLeaf): TabRun[] {
  return rawGroupRuns(leaf) as TabRun[];
}
