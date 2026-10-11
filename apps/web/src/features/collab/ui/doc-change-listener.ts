import { EditorView } from "@codemirror/view";

/**
 * Reports every document change, whatever made it. Paste, undo, drop and remote
 * edits are dispatched by CodeMirror and never fire a DOM "input" event.
 * Reads the callback through the box so the extension can be built once.
 */
export function docChangeListener(box: { current?: (view: EditorView) => void }) {
  return EditorView.updateListener.of((update) => {
    if (update.docChanged) box.current?.(update.view);
  });
}
