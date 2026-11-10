/**
 * Source-note template context (Rust `vault::source_note_context`): the `{{...}}` values of the
 * default source-note template, built from a paper's metadata.
 */
import { sourceNoteTemplateContext as rawSourceNoteTemplateContext } from "../pkg/wf_wasm.js";
import type { SourceNoteInput, SourceNoteTemplateContext } from "./bindings.js";

export type { SourceNoteInput, SourceNoteTemplateContext } from "./bindings.js";

/** The template values for a paper's source note. Missing values are blank strings. */
export function sourceNoteTemplateContext(input: SourceNoteInput): SourceNoteTemplateContext {
  return rawSourceNoteTemplateContext(input) as SourceNoteTemplateContext;
}
