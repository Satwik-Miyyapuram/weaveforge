/** Google Docs-style formatting in the markdown editor: each key's effect on the text. */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  BOLD,
  ITALIC,
  STRIKE,
  UNDERLINE,
  clearFormatting,
  insertLink,
  markdownFormatKeymap,
  setHeading,
  toggleList,
  toggleWrap,
  type Format,
} from "../markdown-format";

/** `doc` with `[` `]` marking the selection (or a lone `|` for a caret), after `format`. */
function apply(doc: string, format: Format): string | null {
  let from: number;
  let to: number;
  if (doc.includes("|")) {
    from = to = doc.indexOf("|");
    doc = doc.replace("|", "");
  } else {
    from = doc.indexOf("[");
    doc = doc.replace("[", "");
    to = doc.indexOf("]");
    doc = doc.replace("]", "");
  }
  const state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  const spec = format(state);
  if (!spec) return null;
  const next = state.update(spec).state;
  const sel = next.selection.main;
  const text = next.doc.toString();
  return sel.empty
    ? `${text.slice(0, sel.from)}|${text.slice(sel.from)}`
    : `${text.slice(0, sel.from)}[${text.slice(sel.from, sel.to)}]${text.slice(sel.to)}`;
}

test("bold wraps the selection and keeps the words selected", () => {
  assert.equal(apply("a [word] b", toggleWrap(BOLD)), "a **[word]** b");
});

test("bold again takes it off", () => {
  assert.equal(apply("a **[word]** b", toggleWrap(BOLD)), "a [word] b");
  assert.equal(apply("a [**word**] b", toggleWrap(BOLD)), "a [word] b");
});

test("bold with no selection leaves the caret between the markers", () => {
  assert.equal(apply("a |b", toggleWrap(BOLD)), "a **|**b");
});

test("italic inside bold adds a star rather than unwrapping the bold", () => {
  assert.equal(apply("**[word]**", toggleWrap(ITALIC)), "***[word]***");
  assert.equal(apply("***[word]***", toggleWrap(ITALIC)), "**[word]**");
  assert.equal(apply("***[word]***", toggleWrap(BOLD)), "*[word]*");
});

test("underline and strikethrough use <u> and ~~", () => {
  assert.equal(apply("[x]", toggleWrap(UNDERLINE)), "<u>[x]</u>");
  assert.equal(apply("<u>[x]</u>", toggleWrap(UNDERLINE)), "[x]");
  assert.equal(apply("[x]", toggleWrap(STRIKE)), "~~[x]~~");
});

test("a heading replaces any heading the line had", () => {
  assert.equal(apply("ti|tle", setHeading(2)), "## ti|tle");
  assert.equal(apply("### ti|tle", setHeading(1)), "# ti|tle");
  assert.equal(apply("## ti|tle", setHeading(0)), "ti|tle");
});

test("a heading the line already has changes nothing", () => {
  assert.equal(apply("## ti|tle", setHeading(2)), null);
});

test("headings apply to every selected line", () => {
  assert.equal(apply("[a\nb]", setHeading(3)), "### [a\n### b]");
});

test("a numbered list counts the selected lines", () => {
  assert.equal(apply("[a\nb\nc]", toggleList("ordered")), "1. [a\n2. b\n3. c]");
});

test("a list again removes the markers", () => {
  assert.equal(apply("[- a\n- b]", toggleList("bullet")), "[a\nb]");
});

test("switching list kind swaps the marker and keeps the indent", () => {
  assert.equal(apply("  - |a", toggleList("ordered")), "  1. |a");
  assert.equal(apply("1. |a", toggleList("task")), "- [ ] |a");
});

test("a bullet toggle does not treat a checklist item as a bullet", () => {
  assert.equal(apply("- [ ] |a", toggleList("bullet")), "- |a");
});

test("blank lines are left out of a list", () => {
  assert.equal(apply("[a\n\nb]", toggleList("bullet")), "- [a\n\n- b]");
});

test("a link selects the address to type over", () => {
  assert.equal(apply("see [docs] now", insertLink), "see [docs]([https://]) now");
});

test("a selected URL becomes the link target, caret on the label", () => {
  assert.equal(apply("[https://x.org]", insertLink), "[|](https://x.org)");
});

test("clear formatting strips inline markers but keeps underscores", () => {
  assert.equal(apply("[**a** *b* <u>c</u> ~~d~~ `e` f_g]", clearFormatting), "[a b c d e f_g]");
});

test("clear formatting with no selection does nothing", () => {
  assert.equal(apply("**a|**", clearFormatting), null);
});

test("the keymap carries Google Docs' keys", () => {
  const keys = markdownFormatKeymap.map((binding) => binding.key);
  for (const key of ["Mod-b", "Mod-i", "Mod-u", "Alt-Shift-5", "Mod-k", "Mod-\\", "Mod-Alt-0", "Mod-Alt-1", "Mod-Alt-6", "Mod-Shift-7", "Mod-Shift-8", "Mod-Shift-9"]) {
    assert.ok(keys.includes(key), key);
  }
  assert.equal(new Set(keys).size, keys.length, "no key bound twice");
});
