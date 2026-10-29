/**
 * A text box on a PDF page grows with its words, and Escape keeps what was
 * typed (design D18, DA-118). Its colours are tokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { grownTextRect, textBoxFromRect } from "../application/draft-local-annotation";
import { TextBoxEditor } from "../ui/annotation-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECT: [number, number, number, number] = [10, 100, 130, 124];

test("a box that needs more room grows down, its top kept", () => {
  assert.deepEqual(grownTextRect(RECT, 50), [10, 74, 130, 124]);
});

test("a box never shrinks below the size it was drawn at", () => {
  assert.deepEqual(grownTextRect(RECT, 10), RECT);
});

test("a rect becomes the draft's corner and size", () => {
  assert.deepEqual(textBoxFromRect([10, 74, 130, 124]), { x: 10, y: 74, width: 120, height: 50 });
});

function editor(rotation = 0) {
  const calls = { commit: [] as Array<[string, unknown]>, cancel: 0 };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      createElement(TextBoxEditor, {
        edit: { id: null, rect: RECT, text: "" },
        projection: { pageWidth: 600, pageHeight: 800, scale: 2, rotation },
        onCommit: (text: string, rect: unknown) => void calls.commit.push([text, rect]),
        onCancel: () => void calls.cancel++,
      }),
    );
  });
  return { area: r.root.findByType("textarea"), calls };
}

/** The textarea as an event sees it: its words and how tall they lay out, in px. */
const target = (value: string, scrollHeight: number) => ({ value, scrollHeight, style: { height: "" } });

test("Escape keeps the words, in a box tall enough for them", () => {
  const { area, calls } = editor();
  act(() => area.props.onKeyDown({ key: "Escape", preventDefault() {}, currentTarget: target("two\nlines", 100) }));
  // 100 px at scale 2 is 50 PDF points.
  assert.deepEqual(calls.commit, [["two\nlines", [10, 74, 130, 124]]]);
  assert.equal(calls.cancel, 0);
});

test("Escape on an empty box drops it", () => {
  const { area, calls } = editor();
  act(() => area.props.onKeyDown({ key: "Escape", preventDefault() {}, currentTarget: target("  ", 48) }));
  assert.deepEqual(calls.commit, []);
  assert.equal(calls.cancel, 1);
});

test("the box grows on screen as words are typed", () => {
  const { area } = editor();
  const el = target("a long line", 90);
  act(() => area.props.onInput({ currentTarget: el }));
  assert.equal(el.style.height, "90px");
  const short = target("a", 20);
  act(() => area.props.onInput({ currentTarget: short }));
  assert.equal(short.style.height, "48px", "never below the drawn 24 pt at scale 2");
});

test("a turned page keeps the drawn rect", () => {
  const { area, calls } = editor(90);
  act(() => area.props.onKeyDown({ key: "Enter", shiftKey: false, preventDefault() {}, currentTarget: target("x", 400) }));
  assert.deepEqual(calls.commit, [["x", RECT]]);
});

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/reader.css", import.meta.url)), "utf8");

test("reader styles name no colour literal (R1.3)", () => {
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], []);
});

test("the text box uses the app font", () => {
  const rule = css.slice(css.indexOf(".pdf-reader-ann.is-text,\n.pdf-reader-text-edit {"));
  assert.match(rule.slice(0, rule.indexOf("}")), /font-family: var\(--font\);/);
});

test("the reader saves the grown rect of a new box", () => {
  const reader = readFileSync(fileURLToPath(new URL("../ui/pdf-reader/pdf-reader.tsx", import.meta.url)), "utf8");
  assert.match(reader, /\(text: string, rect\?: \[number, number, number, number\]\)/);
  assert.match(reader, /textBoxFromRect\(rect\)/);
});

test("the Enter that confirms an IME composition does not save the box", () => {
  const { area, calls } = editor();
  const composing = { key: "Enter", shiftKey: false, preventDefault() {}, currentTarget: target("にほ", 48) };
  act(() => area.props.onKeyDown({ ...composing, nativeEvent: { isComposing: true } }));
  act(() => area.props.onKeyDown({ ...composing, keyCode: 229, nativeEvent: {} }));
  assert.equal(calls.commit.length, 0);
  act(() => area.props.onKeyDown({ ...composing, currentTarget: target("日本", 48), nativeEvent: {} }));
  assert.equal(calls.commit.length, 1);
  assert.equal(calls.commit[0]![0], "日本");
});
