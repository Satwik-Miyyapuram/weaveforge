import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import type { PasteSettings } from "@weaveforge/wasm";
import {
  cleanPdfSelection,
  cleanSelection,
  cleanTerminalSelection,
  formattedPasteText,
  moveCommas,
  pasteCleanupKeymap,
} from "@/components/markdown/markdown-paste-cleanup";
import { readyCore } from "@/lib/rust-core";

const DEFAULT_PASTE_SETTINGS = readyCore().defaultPasteSettings();

/**
 * The editor commands are `StateCommand`s, so they need a document and a
 * dispatch and nothing else — no DOM, no view. That is the reason they are
 * written as state commands rather than as view commands: the behaviour a
 * writer sees is testable here rather than only in a browser.
 */
function run(command: StateCommand, doc: string, selection?: { from: number; to: number }) {
  const state = EditorState.create({
    doc,
    selection: selection ? EditorSelection.single(selection.from, selection.to) : undefined,
  });
  let next = state;
  const applied = command({
    state,
    dispatch: (transaction: Transaction) => {
      next = transaction.state;
    },
  });
  return { applied, doc: next.doc.toString() };
}

const settings = (overrides: Partial<PasteSettings> = {}) => () => ({
  ...DEFAULT_PASTE_SETTINGS,
  ...overrides,
});

test("cleaning a selection leaves the rest of the note alone", () => {
  const doc = "keep https://a.example/x?utm_source=n\nclean https://b.example/y?utm_source=n";
  const from = doc.indexOf("clean");
  const result = run(cleanSelection(settings()), doc, { from, to: doc.length });
  assert.equal(
    result.doc,
    "keep https://a.example/x?utm_source=n\nclean https://b.example/y",
  );
});

test("with nothing selected the command runs on the whole note", () => {
  const result = run(cleanSelection(settings()), "https://a.example/x?utm_source=n");
  assert.equal(result.doc, "https://a.example/x");
  assert.equal(result.applied, true);
});

test("a command that changes nothing reports that it did nothing", () => {
  const result = run(cleanSelection(settings()), "nothing to do here");
  assert.equal(result.applied, false);
  assert.equal(result.doc, "nothing to do here");
});

test("the master switch does not disable the on-demand cleanup", () => {
  // Turning automatic cleanup off is a statement about pasting, not about the
  // command the writer just ran on purpose.
  const result = run(
    cleanSelection(settings({ cleanOnPaste: false })),
    "https://a.example/x?utm_source=n",
  );
  assert.equal(result.doc, "https://a.example/x");
});

test("terminal cleanup rejoins a wrapped line and converts a bullet", () => {
  const doc =
    "npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do\n  not use it.\n\n• second";
  const result = run(cleanTerminalSelection, doc);
  assert.equal(
    result.doc,
    "npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do not use it.\n\n- second",
  );
});

test("PDF cleanup mends a word split across a line", () => {
  const result = run(
    cleanPdfSelection({ removePageNumbers: false, singleParagraph: false }),
    "The findings suggest that long-term expo-\nsure has a measurable effect.",
  );
  assert.equal(result.doc, "The findings suggest that long-term exposure has a measurable effect.");
});

test("comma placement moves only quoted prose", () => {
  const result = run(moveCommas("outside"), 'She called it "finished," then left.');
  assert.equal(result.doc, 'She called it "finished", then left.');

  const csv = run(moveCommas("outside"), 'name,"John Smith", age');
  assert.equal(csv.applied, false);
});

test("a multi-range selection is transformed range by range", () => {
  const doc = "a https://x.example/1?utm_source=n b https://y.example/2?utm_source=n c";
  const first = doc.indexOf("https://x");
  const second = doc.indexOf("https://y");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([
      EditorSelection.range(first, first + "https://x.example/1?utm_source=n".length),
      EditorSelection.range(second, second + "https://y.example/2?utm_source=n".length),
    ]),
    // Without the facet CodeMirror keeps only the main range, so a state built
    // for this test would silently exercise the single-range path.
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  let next = state;
  cleanSelection(settings())({
    state,
    dispatch: (transaction: Transaction) => {
      next = transaction.state;
    },
  });
  assert.equal(next.doc.toString(), "a https://x.example/1 b https://y.example/2 c");
});

test("paste with formatting converts the HTML when there is some", () => {
  assert.equal(
    formattedPasteText({ html: "<b>x</b>", plain: "x" }, false, () => "**x**"),
    "**x**",
  );
});

test("paste with formatting falls back to plain text when there is no usable HTML", () => {
  const unused = () => {
    throw new Error("converter must not be called");
  };
  const toMarkdown = (h: string) => `md:${h}`;
  assert.equal(formattedPasteText({ html: null, plain: "p" }, false, toMarkdown), "p");
  assert.equal(formattedPasteText({ html: "", plain: "p" }, false, toMarkdown), "p");
  assert.equal(formattedPasteText({ html: "<b>x</b>", plain: "p" }, false, () => "  \n"), "p");
  assert.equal(formattedPasteText({ html: "<b>x</b>", plain: "p" }, true, unused), "p");
});

test("paste with formatting converts through the core", () => {
  const text = formattedPasteText(
    {
      html: '<p>Hello <b>bold</b> <a href="https://x.org">link</a></p><ul><li>a</li></ul>',
      plain: "ignored",
    },
    false,
    (h) => readyCore().htmlToMarkdown(h),
  );
  assert.equal(text, "Hello **bold** [link](https://x.org)\n\n- a");
});

test("paste with formatting strips scripts through the core", () => {
  const text = formattedPasteText(
    { html: "<p>ok</p><script>alert(1)</script>", plain: "ignored" },
    false,
    (h) => readyCore().htmlToMarkdown(h),
  );
  assert.equal(text, "ok");
});

test("paste with formatting falls back to plain text for images with data: sources", () => {
  const text = formattedPasteText(
    { html: '<img src="data:image/png;base64,AA">', plain: "img" },
    false,
    (h) => readyCore().htmlToMarkdown(h),
  );
  assert.equal(text, "img");
});

test("the paste keymap binds formatted and plain paste to distinct keys", () => {
  const bindings = pasteCleanupKeymap({ settings: settings() });
  const formatted = bindings.find((b) => b.key === "Mod-Shift-v");
  const plain = bindings.find((b) => b.key === "Mod-Alt-Shift-v");
  assert.equal(formatted?.run?.name, "pasteWithFormatting");
  assert.equal(plain?.run?.name, "pastePlainText");
  const keys = bindings.map((b) => b.key);
  assert.equal(new Set(keys).size, keys.length);
});
