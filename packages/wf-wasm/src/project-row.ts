/**
 * Project row mapping (Rust `project_row`). The column list stays in the web app,
 * next to the queries that select it.
 */
import { projectFromRow as rawProjectFromRow } from "../pkg/wf_wasm.js";
import type { Project, ProjectRow } from "./bindings.js";

export type { Project, ProjectRow } from "./bindings.js";

/** A `projects` row as the app's project. */
export function projectFromRow(row: ProjectRow): Project {
  return rawProjectFromRow(row) as Project;
}
