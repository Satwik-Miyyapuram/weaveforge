/**
 * Hashtag edits on a note body (Rust `papers::note_tags`), re-exported from index.ts.
 * Keeps the signatures of the helpers in apps/web/src/features/papers/lib/note-tags.ts.
 */
export {
  appendTagHashtags,
  removeHashtagFromBody,
  tagToHashtag,
} from "../pkg/wf_wasm.js";

