/**
 * Project row mapping (Rust `project_row`). The column list stays in the web app,
 * next to the queries that select it.
 */
import type {
  Project,
  ProjectRow,
} from "./bindings.js";

export {
  projectFromRow,
} from "../pkg/wf_wasm.js";

export type { Project, ProjectRow } from "./bindings.js";

