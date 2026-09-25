import { test } from "node:test";
import assert from "node:assert/strict";

import { rendererFor, tabForHref } from "../ui/document-host";

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
  assert.equal(rendererFor("paper_pdf", "pdf"), "pdf");
  assert.equal(rendererFor("paper_pdf", "ink"), "pdf_ink");
});
