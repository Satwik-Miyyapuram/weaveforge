/**
 * Hashtag edits on a note body (Rust `papers::note_tags`), re-exported from index.ts.
 * Keeps the signatures of the helpers in apps/web/src/features/papers/lib/note-tags.ts.
 */
import {
  appendTagHashtags as rawAppendTagHashtags,
} from "../pkg/wf_wasm.js";

export {
  removeHashtagFromBody,
  tagToHashtag,
} from "../pkg/wf_wasm.js";

/** Append a `#hashtag` line for each tag name the body does not already have. */
export function appendTagHashtags(body: string, tagNames: readonly string[]): string {
  return rawAppendTagHashtags(body, [...tagNames]);
}

