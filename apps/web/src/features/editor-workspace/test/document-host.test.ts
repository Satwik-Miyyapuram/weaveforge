import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupeMetrics, isInAppHref, rendererFor, surfaceBody, tabForHref, type DocumentMetrics } from "../ui/document-host";

const INK_HEADER = "<!-- weaveforge-ink ink-pages=1 ink-paper=blank -->";
const PLAIN_NOTE = "## A note\n\nJust prose.";

test("a resolver href reads back as the tab it names", () => {
  assert.deepEqual(tabForHref("/notes?page=n1"), { kind: "vault_page", id: "n1" });
  assert.deepEqual(tabForHref("/papers?paper=p1"), { kind: "paper", id: "p1" });
  assert.deepEqual(tabForHref("/report?section=s1"), { kind: "report_section", id: "s1" });
});

test("anything else is not a tab", () => {
  assert.equal(tabForHref(null), null);
  assert.equal(tabForHref("/notes"), null);
  assert.equal(tabForHref("https://example.com/notes?page=n1"), null);
});

test("only a same-origin path is routed in the app (28-12)", () => {
  assert.equal(isInAppHref("/notes?page=n1"), true);
  assert.equal(isInAppHref("/"), true);
  assert.equal(isInAppHref("//evil.example/x"), false);
  assert.equal(isInAppHref("/\\evil.example/x"), false);
  assert.equal(isInAppHref("https://example.com/"), false);
  assert.equal(isInAppHref("notes"), false);
  assert.equal(isInAppHref(""), false);
});

test("Read mode of a note with ink in it is the sheet, not the prose", () => {
  // One note kind holds both: you type in Edit, you draw over it in Ink. Read
  // is the same sheet with the pen down, so it must not fall back to markdown —
  // that dropped the strokes, the figures and the diagrams, and showed a
  // different document from the one Ink was drawing on.
  assert.equal(rendererFor("vault_page", "read", INK_HEADER), "ink_reader");
  assert.equal(rendererFor("paper", "read", INK_HEADER), "ink_reader");
});

test("Read mode of a note with no ink in it stays prose", () => {
  assert.equal(rendererFor("vault_page", "read", PLAIN_NOTE), "markdown");
  assert.equal(rendererFor("paper", "read", PLAIN_NOTE), "markdown");
  // A body that never arrived cannot be mistaken for an ink note.
  assert.equal(rendererFor("vault_page", "read"), "markdown");
});

test("the other modes are unchanged by an ink body", () => {
  assert.equal(rendererFor("vault_page", "edit", INK_HEADER), "editor");
  assert.equal(rendererFor("vault_page", "ink", INK_HEADER), "ink");
  // A PDF row reads and inks through the reader, never the ink sheet.
  assert.equal(rendererFor("paper_pdf", "ink"), "pdf_ink");
});

test("one edit is one metrics report, however many events carry it (28-06)", () => {
  const seen: DocumentMetrics[] = [];
  const report = dedupeMetrics((m) => seen.push(m));
  const typed = { text: "ab", cursor: { line: 1, col: 3 } };
  report({ text: "a", cursor: { line: 1, col: 2 } });
  // A keystroke arrives as the doc change, the DOM input and the keyup.
  report(typed);
  report({ ...typed, cursor: { ...typed.cursor } });
  report(typed);
  assert.equal(seen.length, 2);
  // A cursor move with no edit still reports, so the status bar follows it.
  report({ text: "ab", cursor: { line: 1, col: 1 } });
  // And so does an edit that leaves the cursor where it was.
  report({ text: "xb", cursor: { line: 1, col: 1 } });
  assert.deepEqual(seen.map((m) => [m.text, m.cursor?.col]), [["a", 2], ["ab", 3], ["ab", 1], ["xb", 1]]);
});

test("Ink opens on the text just typed, not the last saved body (E35)", () => {
  // Switching from Edit to Ink mounts the sheet before the editor's save has
  // landed, so the saved body is a step behind what is on screen.
  assert.equal(surfaceBody("old", "old and new"), "old and new");
  // Text deleted down to nothing is still the latest text.
  assert.equal(surfaceBody("old", ""), "");
  // Nothing typed yet: the saved body.
  assert.equal(surfaceBody("saved", null), "saved");
});
