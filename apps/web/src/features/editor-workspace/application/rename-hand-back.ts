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
