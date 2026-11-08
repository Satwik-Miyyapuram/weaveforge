/** The editor's right-click menu: which items show with and without a selection. */
import assert from "node:assert/strict";
import test from "node:test";
import type { MenuItem } from "../../menu";
import { editorMenuItems, opensAppMenu, type EditorMenuContext } from "../markdown-context-menu";

function ctx(over: Partial<EditorMenuContext> = {}): EditorMenuContext & { applied: string[] } {
  const applied: string[] = [];
  return {
    applied,
    hasSelection: false,
    readOnly: false,
    apply: (action) => applied.push(action.id),
    cut: () => applied.push("cut"),
    copy: () => applied.push("copy"),
    paste: () => applied.push("paste"),
    selectAll: () => applied.push("select-all"),
    spellcheck: true,
    toggleSpellcheck: () => applied.push("spellcheck"),
    ...over,
  };
}

const ids = (items: readonly MenuItem[]) => items.filter((i) => i.kind !== "separator").map((i) => i.id);

test("with a selection: clipboard, inline formats, then headings and lists", () => {
  assert.deepEqual(ids(editorMenuItems(ctx({ hasSelection: true }))), [
    "cut", "copy", "paste",
    "bold", "italic", "underline", "strike", "code", "sup", "sub", "link", "clear",
    "headings", "lists",
    "spellcheck",
  ]);
});

test("with only a caret: paste, select all, block formats and link", () => {
  assert.deepEqual(ids(editorMenuItems(ctx())), ["paste", "select-all", "headings", "lists", "link", "spellcheck"]);
});

test("items run their action and show the shortcut", () => {
  const c = ctx({ hasSelection: true });
  const bold = editorMenuItems(c).find((i) => i.id === "bold")!;
  assert.equal(bold.accelerator, "Ctrl+B");
  bold.onSelect?.();
  assert.deepEqual(c.applied, ["bold"]);
});

test("the headings submenu lists normal text and six levels", () => {
  const headings = editorMenuItems(ctx()).find((i) => i.id === "headings")!;
  assert.ok(Array.isArray(headings.submenu));
  assert.deepEqual(ids(headings.submenu as MenuItem[]), ["normal", "h1", "h2", "h3", "h4", "h5", "h6"]);
});

test("a read-only editor still copies but cannot change the text", () => {
  const items = editorMenuItems(ctx({ hasSelection: true, readOnly: true }));
  const disabled = (id: string) => items.find((i) => i.id === id)?.disabled === true;
  assert.equal(disabled("copy"), false);
  for (const id of ["cut", "paste", "bold", "headings", "lists"]) assert.ok(disabled(id), id);
});

test("Check spelling is a check item that shows and flips the setting", () => {
  const off = ctx({ spellcheck: false });
  const item = editorMenuItems(off).find((i) => i.id === "spellcheck")!;
  assert.equal(item.kind, "check");
  assert.equal(item.checked, false);
  assert.equal(editorMenuItems(ctx()).find((i) => i.id === "spellcheck")!.checked, true);
  item.onSelect?.();
  assert.deepEqual(off.applied, ["spellcheck"]);
});

test("Shift+right-click leaves the system menu (spelling fixes) alone", () => {
  assert.equal(opensAppMenu({ shiftKey: false }), true);
  assert.equal(opensAppMenu({ shiftKey: true }), false);
});
