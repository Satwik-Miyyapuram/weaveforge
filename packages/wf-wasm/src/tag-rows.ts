/**
 * Tag and paper-tag row mapping (Rust `tag_row`). The column lists stay in the web app,
 * next to the queries that select them.
 */
export {
  paperTagFromRow,
  tagFromRow,
} from "../pkg/wf_wasm.js";

export type { PaperTagRowInput, TagRowInput } from "./bindings.js";
