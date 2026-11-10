/**
 * Source-note template context (Rust `vault::source_note_context`): the `{{...}}` values of the
 * default source-note template, built from a paper's metadata.
 */
import type {
  SourceNoteInput,
  SourceNoteTemplateContext,
} from "./bindings.js";

export {
  sourceNoteTemplateContext,
} from "../pkg/wf_wasm.js";

export type { SourceNoteInput, SourceNoteTemplateContext } from "./bindings.js";

