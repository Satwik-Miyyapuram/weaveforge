/**
 * Hashtag edits on a note body (Rust `papers::note_tags`), re-exported from index.ts.
 * Keeps the signatures of the helpers in apps/web/src/features/papers/lib/note-tags.ts.
 */
import {
  appendTagHashtags as rawAppendTagHashtags,
  removeHashtagFromBody as rawRemoveHashtagFromBody,
  tagToHashtag as rawTagToHashtag,
} from "../pkg/wf_wasm.js";

/** Slugify a tag name into one `#hashtag`, or "" when nothing usable is left. */
export function tagToHashtag(name: string): string {
  return rawTagToHashtag(name);
}

/** Append a `#hashtag` line for each tag name the body does not already have. */
export function appendTagHashtags(body: string, tagNames: readonly string[]): string {
  return rawAppendTagHashtags(body, [...tagNames]);
}

/** Remove every `#hashtag` whose normalized name equals `tag`, then tidy the whitespace left behind. */
export function removeHashtagFromBody(body: string, tag: string): string {
  return rawRemoveHashtagFromBody(body, tag);
}
