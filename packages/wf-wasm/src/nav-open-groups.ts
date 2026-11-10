/**
 * Which sidebar groups are unfolded (Rust `nav_open_groups`), re-exported from
 * index.ts. The localStorage I/O lives in the web app, not here.
 */
import {
  loadOpenGroups as rawLoadOpenGroups,
  withActive as rawWithActive,
} from "../pkg/wf_wasm.js";

export {
  encodeOpenGroups,
  toggleGroup,
} from "../pkg/wf_wasm.js";

/** The group you are in is always open, so `active` is added when it is not listed. */
export function withActive(groups: readonly string[], active: string | null): string[] {
  return rawWithActive(groups, active ?? undefined) as string[];
}

/** The open groups from the stored JSON (`null` when none), with `active` forced open. */
export function loadOpenGroups(raw: string | null, active: string | null): string[] {
  return rawLoadOpenGroups(raw ?? undefined, active ?? undefined) as string[];
}

