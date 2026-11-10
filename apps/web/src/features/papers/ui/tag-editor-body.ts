import { readyCore } from "@/lib/rust-core";

/** The part of the note editor a tag chip needs. */
export interface LiveText {
  text(): string;
  replaceAll(markdown: string): void;
}

/**
 * The body with `#tag` removed. With the editor open, the live text is changed
 * in place, unsaved edits and all, so its next autosave keeps the removal.
 */
export function bodyWithoutTag(tag: string, editor: LiveText | null | undefined, saved: string): string {
  const body = readyCore().removeHashtagFromBody(editor ? editor.text() : saved, tag);
  editor?.replaceAll(body);
  return body;
}
