/**
 * The Edit menu's entries in the desktop shell. The shell sends `edit-*` page
 * commands (see `edit_command` in apps/shell/src/menu.rs) and the page runs
 * them on whatever has focus, because a webview has no native edit roles.
 */

import { showToast } from "@/lib/toast/index";

/** The part of `document` the edit commands use. */
export interface EditDocument {
  execCommand(commandId: string, showUI?: boolean, value?: string): boolean;
}

/** The part of `navigator.clipboard` paste uses. */
export interface EditClipboard {
  readText(): Promise<string>;
}

const EXEC: Record<string, string> = {
  "edit-undo": "undo",
  "edit-redo": "redo",
  "edit-cut": "cut",
  "edit-copy": "copy",
  "edit-select-all": "selectAll",
};

/**
 * Runs one Edit menu command on the focused element. Paste reads the
 * clipboard and inserts its text, since `execCommand("paste")` is refused in
 * a page. Answers whether anything ran; rejects when the clipboard read fails.
 * A refused paste or an empty clipboard is also said by `toast`, so the user
 * is not left wondering why nothing happened.
 */
export async function runEditCommand(
  command: string,
  doc: EditDocument,
  clipboard: EditClipboard,
  toast: (message: string) => void = showToast,
): Promise<boolean> {
  if (command === "edit-paste") {
    let text: string;
    try {
      text = await clipboard.readText();
    } catch (error) {
      toast("Paste was blocked — use Ctrl+V");
      throw error;
    }
    if (text === "") {
      toast("Clipboard is empty");
      return false;
    }
    return doc.execCommand("insertText", false, text);
  }
  const exec = Object.hasOwn(EXEC, command) ? EXEC[command] : undefined;
  return exec === undefined ? false : doc.execCommand(exec);
}
