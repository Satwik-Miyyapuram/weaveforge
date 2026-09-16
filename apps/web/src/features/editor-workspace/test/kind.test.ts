import { test } from "node:test";
import assert from "node:assert/strict";

import { KIND_SUFFIX } from "@weaveforge/core";

import {
  FALLBACK_KIND,
  KINDS,
  documentKind,
  documentSuffix,
  hasInkView,
  hasPdfView,
  isDocumentKind,
  kindIcon,
  kindOwner,
  kindSuffix,
  kindTintClass,
  labelledTitle,
  linkGroupOf,
  memberRank,
  segmentsFor,
} from "../ui/kind";
import { rendererFor, supportsEditMode } from "../ui/document-host";

test("every kind the explorer can show has an icon and a suffix", () => {
  for (const kind of KINDS) {
    if (kind === "folder") continue;
    assert.ok(kindIcon(kind), `${kind} has no icon`);
    assert.ok(kindSuffix(kind), `${kind} has no suffix`);
  }
});

test("the suffix is the one the mirrored folder writes, computed not typed", () => {
  for (const [kind, suffix] of Object.entries(KIND_SUFFIX)) {
    assert.equal(kindSuffix(kind), `.${suffix}.md`, kind);
  }
});

test("a folder is a grouping, not a file, so it carries no suffix", () => {
  assert.equal(documentSuffix("folder"), "");
  assert.equal(segmentsFor("folder").length, 0);
});

test("a kind core has not taught the editor yet still renders as text", () => {
  // `packages/core` gaining an entity type must not break this screen: the
  // unknown kind reads as a plain text document with the fallback icon.
  assert.equal(kindIcon("something_new"), kindIcon(FALLBACK_KIND));
  assert.equal(documentKind("something_new"), "text");
  assert.deepEqual(segmentsFor("something_new"), []);
});

test("an ink note is its own row: ink, the ink tint, .ink.md, the ink renderer", () => {
  assert.equal(kindIcon("ink_page"), "ink");
  assert.equal(kindTintClass("ink_page"), "kind-tint-danger");
  assert.equal(kindSuffix("ink_page"), ".ink.md");
  assert.equal(documentKind("ink_page"), "ink");
  assert.equal(documentSuffix("ink_page"), ".ink.md");
  assert.equal(labelledTitle("Supervisor meeting", "ink_page"), "Supervisor meeting.ink.md");
  assert.equal(isDocumentKind("ink_page"), true);
  // A note, so it resolves against the notes table and a `[[link]]` can point
  // at it exactly as it points at a typed note.
  assert.equal(linkGroupOf("ink_page"), "notes");
  assert.equal(memberRank("ink_page"), memberRank("vault_page"));
});

test("the ink status bar says pages and strokes, not words and lines", () => {
  assert.deepEqual(segmentsFor("ink_page"), ["page", "strokes", "pen", "recognised", "ink"]);
});

test("a text document in edit mode is the shipped editor, in read mode markdown", () => {
  assert.equal(rendererFor("vault_page", "edit"), "editor");
  assert.equal(rendererFor("vault_page", "read"), "markdown");
  assert.equal(rendererFor("paper", "edit"), "editor");
  assert.equal(rendererFor("paper", "read"), "markdown");
});

test("an ink note can be viewed in edit, read and ink modes", () => {
  assert.equal(rendererFor("ink_page", "edit"), "editor");
  assert.equal(rendererFor("ink_page", "read"), "markdown");
  assert.equal(rendererFor("ink_page", "ink"), "ink");
});

test("PDF is a paper's third mode; on anything else it means Edit", () => {
  assert.equal(rendererFor("paper", "pdf"), "pdf");
  assert.equal(rendererFor("vault_page", "pdf"), "editor");
  assert.equal(rendererFor("ink_page", "pdf"), "editor");
});

test("the table says which kinds have a PDF to look at", () => {
  // A paper is a PDF; a note is text that may quote one, and a section is this
  // app's own prose. Only the row that says so gets the third mode button.
  assert.equal(hasPdfView("paper"), true);
  assert.equal(hasPdfView("vault_page"), false);
  assert.equal(hasPdfView("ink_page"), false);
  assert.equal(hasPdfView("report_section"), false);
  assert.equal(hasPdfView("something_new"), false);
});

test("the table says which kinds have an Ink canvas to draw on", () => {
  assert.equal(hasInkView("vault_page"), true);
  assert.equal(hasInkView("ink_page"), true);
  assert.equal(hasInkView("paper"), false);
  assert.equal(hasInkView("report_section"), false);
  assert.equal(hasInkView("something_new"), false);
  assert.equal(rendererFor("vault_page", "ink"), "ink");
});

test("the table says which surface renames and moves a kind", () => {
  // The outline and the vault are separate stores with separate use cases, so
  // which one a row belongs to is a row's fact, not a condition at the call.
  assert.equal(kindOwner("report_section"), "report");
  assert.equal(kindOwner("vault_page"), "vault");
  assert.equal(kindOwner("ink_page"), "vault");
  assert.equal(kindOwner("paper"), "vault");
});

test("an unknown kind is safe in both modes", () => {
  assert.equal(rendererFor("something_new", "edit"), "editor");
  assert.equal(rendererFor("something_new", "read"), "markdown");
});

test("Edit / Read applies to text kinds only", () => {
  assert.equal(supportsEditMode("paper"), true);
  assert.equal(supportsEditMode("vault_page"), true);
  assert.equal(supportsEditMode("something_new"), true, "an unknown kind is text, so it has both modes");
  assert.equal(supportsEditMode("ink_page"), true, "ink notes support edit mode");
});

test("the status bar segments a kind declares are the text ones", () => {
  assert.deepEqual(segmentsFor("paper"), ["words", "chars", "cursor", "encoding", "language"]);
  assert.deepEqual(segmentsFor("report_section"), segmentsFor("vault_page"));
});

test("a tint is a class, never a colour written in code", () => {
  assert.equal(kindTintClass("paper"), "kind-tint-warn");
  assert.equal(kindTintClass("vault_page"), "kind-tint-info");
  assert.equal(kindTintClass("reading_list"), "kind-tint-accent");
  assert.equal(kindTintClass("report_section"), "kind-tint-good");
  assert.equal(kindTintClass("folder"), null);
});

test("a label carries its suffix where the row's context is gone", () => {
  assert.equal(labelledTitle("Baselines", "vault_page"), "Baselines.note.md");
  assert.equal(labelledTitle("Higgins 2017", "paper"), "Higgins 2017.paper.md");
  assert.equal(labelledTitle("Latent spaces", "reading_list"), "Latent spaces.list.md");
});

test("the table says which kinds are documents and which are groupings", () => {
  assert.equal(isDocumentKind("vault_page"), true);
  assert.equal(isDocumentKind("paper"), true);
  assert.equal(isDocumentKind("reading_list"), true);
  assert.equal(isDocumentKind("folder"), false);
  // An unknown kind reads as the fallback row, which is a grouping row: the
  // safe answer, because opening a tab for something with no writer does
  // nothing, where refusing to open one would lose the row instead.
  assert.equal(isDocumentKind("something_new"), false);
});

test("member rows are ranked papers-then-notes, and unranked kinds sort last", () => {
  assert.ok(memberRank("paper") < memberRank("vault_page"));
  // A kind that is never a list member carries no rank, so it cannot
  // accidentally slot in ahead of one that is.
  assert.equal(memberRank("report_section"), Number.MAX_SAFE_INTEGER);
  assert.equal(memberRank("experiment"), Number.MAX_SAFE_INTEGER);
});

test("each linkable kind resolves against exactly one wikilink table", () => {
  assert.equal(linkGroupOf("vault_page"), "notes");
  assert.equal(linkGroupOf("paper"), "papers");
  assert.equal(linkGroupOf("report_section"), "sections");
  // A link cannot point at a list, a folder or an experiment, and saying so
  // here is what keeps those out of Read mode's lookup tables.
  assert.equal(linkGroupOf("reading_list"), null);
  assert.equal(linkGroupOf("folder"), null);
  assert.equal(linkGroupOf("experiment"), null);
});
