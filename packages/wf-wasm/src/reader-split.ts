/**
 * The reader's side panel choice (Rust `reader::split`), re-exported from index.ts.
 */
import type {
  ReaderSplitPane,
} from "./bindings.js";

export {
  parseReaderSplitPane,
} from "../pkg/wf_wasm.js";

export type { ReaderSplitPane };

