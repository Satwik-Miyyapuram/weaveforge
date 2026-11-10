/**
 * Adoption rename plan (Rust `sync::adoption_plan`), re-exported from index.ts.
 */
import { planRenames as rawPlanRenames } from "../pkg/wf_wasm.js";

/** A local project as the rename sees it. */
export interface LocalProject {
  id: string;
  name: string;
}

/** One rename to apply: a project, the name it had, and the name it takes. */
export interface Rename {
  id: string;
  from: string;
  to: string;
}

/**
 * The renames adoption needs. `local` must be in name order, as the query returns them.
 */
export function planRenames(
  local: readonly LocalProject[],
  remoteNames: readonly string[],
  deviceLabel: string,
): Rename[] {
  return rawPlanRenames(local, remoteNames, deviceLabel) as Rename[];
}
