import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { MenuItem } from "@/components/menu";
import { openContextMenu } from "@/components/context-menu-store";
import { HEADING_ACTIONS, INLINE_ACTIONS, LIST_ACTIONS, run, type FormatAction } from "./markdown-format";

/** What the editor menu needs from the editor, so the item list is testable without a DOM. */
export interface EditorMenuContext {
  hasSelection: boolean;
  readOnly: boolean;
  apply: (action: FormatAction) => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
}

const SEP = (id: string): MenuItem => ({ id, label: "", kind: "separator" });

function asItem(action: FormatAction, ctx: EditorMenuContext): MenuItem {
  return {
    id: action.id,
    label: action.label,
    accelerator: action.accelerator,
    disabled: ctx.readOnly,
    onSelect: () => ctx.apply(action),
  };
}

function byId(actions: readonly FormatAction[], id: string): FormatAction {
  const action = actions.find((a) => a.id === id);
  if (!action) throw new Error(`no format action ${id}`);
  return action;
}

/**
 * The editor's right-click menu, as in Google Docs: with text selected it
 * leads with clipboard and inline formats; with only a caret it offers paste
 * and the block formats.
 */
export function editorMenuItems(ctx: EditorMenuContext): MenuItem[] {
  const ro = ctx.readOnly;
  const blocks: MenuItem[] = [
    { id: "headings", label: "Headings", disabled: ro, submenu: HEADING_ACTIONS.map((a) => asItem(a, ctx)) },
    { id: "lists", label: "Lists", disabled: ro, submenu: LIST_ACTIONS.map((a) => asItem(a, ctx)) },
  ];
  if (ctx.hasSelection) {
    return [
      { id: "cut", label: "Cut", accelerator: "Ctrl+X", disabled: ro, onSelect: ctx.cut },
      { id: "copy", label: "Copy", accelerator: "Ctrl+C", onSelect: ctx.copy },
      { id: "paste", label: "Paste", accelerator: "Ctrl+V", disabled: ro, onSelect: ctx.paste },
      SEP("sep-clip"),
      ...INLINE_ACTIONS.map((a) => asItem(a, ctx)),
      SEP("sep-inline"),
      ...blocks,
    ];
  }
  return [
    { id: "paste", label: "Paste", accelerator: "Ctrl+V", disabled: ro, onSelect: ctx.paste },
    { id: "select-all", label: "Select all", accelerator: "Ctrl+A", onSelect: ctx.selectAll },
    SEP("sep-clip"),
    ...blocks,
    asItem(byId(INLINE_ACTIONS, "link"), ctx),
  ];
}

function selectedText(view: EditorView): string {
  return view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join("\n");
}

/** The menu's context for a live editor. Clipboard goes through `navigator.clipboard`. */
function liveContext(view: EditorView): EditorMenuContext {
  const readOnly = view.state.readOnly || !view.state.facet(EditorView.editable);
  const after = () => view.focus();
  return {
    hasSelection: view.state.selection.ranges.some((r) => !r.empty),
    readOnly,
    apply: (action) => {
      run(action.format)(view);
      after();
    },
    copy: () => {
      void navigator.clipboard?.writeText(selectedText(view)).catch(() => undefined);
      after();
    },
    cut: () => {
      const text = selectedText(view);
      void navigator.clipboard
        ?.writeText(text)
        .then(() => view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut" }))
        .catch(() => undefined);
      after();
    },
    paste: () => {
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
        })
        .catch(() => undefined);
      after();
    },
    selectAll: () => {
      view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
      after();
    },
  };
}

/**
 * Right-click in the editor opens the app's menu. A click outside the
 * selection moves the caret there first, so the menu acts where you clicked.
 */
export const markdownContextMenu = EditorView.domEventHandlers({
  contextmenu(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null && !view.state.selection.ranges.some((r) => r.from <= pos && pos <= r.to)) {
      view.dispatch({ selection: EditorSelection.cursor(pos) });
    }
    openContextMenu(event, editorMenuItems(liveContext(view)));
    return true;
  },
});
