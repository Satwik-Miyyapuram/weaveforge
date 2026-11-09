/**
 * The reader's side panel choice (Rust `reader::split`), re-exported from index.ts.
 */
import { parseReaderSplitPane as rawParseReaderSplitPane } from "../pkg/wf_wasm.js";
import type { ReaderSplitPane } from "./bindings.js";

export type { ReaderSplitPane };

/** The pane a `pane` query value names; null for any other value. */
export function parseReaderSplitPane(raw: string | null): ReaderSplitPane | null {
  return rawParseReaderSplitPane(raw) as ReaderSplitPane | null;
}
