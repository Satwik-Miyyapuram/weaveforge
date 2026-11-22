import type { EditorHandle } from "@/components/editor-handle";

/**
 * A rename rewrites the note's own `[[Old]]` self-links and returns the new
 * body as `linkRewrittenBody`. An open editor holds its own copy of the body,
 * so the new text goes through the editor and its autosave stores it. A note
 * that is not open has nothing to overwrite, so the body is saved directly.
 */
export async function handBackRenamedBody(
  renamed: { linkRewrittenBody?: string },
  editor: EditorHandle | null,
  store: (body: string) => Promise<unknown>,
): Promise<void> {
  const body = renamed.linkRewrittenBody;
  if (body === undefined) return;
  if (editor) editor.replaceAll(body);
  else await store(body);
}
