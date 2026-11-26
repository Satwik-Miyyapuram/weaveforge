import type { EditorHandle } from "@/components/editor-handle";

/**
 * A rename rewrites the note's own `[[Old]]` self-links. An open editor holds
 * its own copy of the body, and that copy can hold unsaved typing, so the
 * rewrite runs on the editor's text at the moment it is applied, not on the
 * body the rename read. The result goes through the editor and its autosave
 * stores it. A note that is not open has nothing to overwrite, so the body the
 * rename rewrote is saved directly.
 */
export async function handBackRenamedBody(
  renamed: { linkRewrittenBody?: string },
  editor: EditorHandle | null,
  store: (body: string) => Promise<unknown>,
  rewriteOpen: (text: string) => string,
): Promise<void> {
  const body = renamed.linkRewrittenBody;
  if (body === undefined) return;
  if (editor) {
    const current = editor.text();
    const next = rewriteOpen(current);
    if (next !== current) editor.replaceAll(next);
  } else {
    await store(body);
  }
}

type OpenLinkers = {
  readonly linkRewriteFailed?: readonly string[];
  readonly linkRewriteOpen?: readonly { readonly id: string; readonly title: string }[];
};

/**
 * Other notes that link to the old title but are open in an editor were left
 * out of the rename's rewrite, because their autosave would put `[[Old]]` back.
 * The ones open here are rewritten through their editor, from its current text,
 * and its autosave stores them. Only the notes no editor here holds stay
 * reported in `linkRewriteFailed`.
 */
export function handBackOpenLinkers<T extends OpenLinkers>(
  renamed: T,
  editorOf: (id: string) => EditorHandle | null,
  rewrite: (text: string) => string,
): T {
  const open = renamed.linkRewriteOpen ?? [];
  if (open.length === 0) return renamed;
  const failed = [...(renamed.linkRewriteFailed ?? [])];
  for (const note of open) {
    const editor = editorOf(note.id);
    if (!editor) continue;
    const current = editor.text();
    const next = rewrite(current);
    if (next !== current) editor.replaceAll(next);
    const at = failed.indexOf(note.title);
    if (at >= 0) failed.splice(at, 1);
  }
  return { ...renamed, linkRewriteFailed: failed };
}
