export {
  applyGroupCommand,
  cleanGroups,
  groupRuns,
  withoutGroup,
} from "../pkg/wf_wasm.js";
/**
 * Tab groups (Rust `editor_workspace::tab_groups`), re-exported from index.ts.
 */

/** The colours a group can take (Rust `GROUP_COLORS`). */
export const GROUP_COLORS = [1, 2, 3, 4, 5, 6] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

