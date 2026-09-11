import { test } from "node:test";
import assert from "node:assert/strict";

import { KIND_SUFFIX } from "@weaveforge/core";

import {
  FALLBACK_KIND,
  KINDS,
  documentKind,
  documentSuffix,
  kindIcon,
  kindSuffix,
  kindTintClass,
  labelledTitle,
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
  assert.equal(kindIcon("ink_page"), kindIcon(FALLBACK_KIND));
  assert.equal(documentKind("ink_page"), "text");
  assert.deepEqual(segmentsFor("ink_page"), []);
});

test("a text document in edit mode is the shipped editor, in read mode markdown", () => {
  assert.equal(rendererFor("vault_page", "edit"), "editor");
  assert.equal(rendererFor("vault_page", "read"), "markdown");
  assert.equal(rendererFor("paper", "edit"), "editor");
  assert.equal(rendererFor("paper", "read"), "markdown");
});

test("an unknown kind is safe in both modes", () => {
  assert.equal(rendererFor("something_new", "edit"), "editor");
  assert.equal(rendererFor("something_new", "read"), "markdown");
});

test("Edit / Read applies to text kinds only", () => {
  assert.equal(supportsEditMode("paper"), true);
  assert.equal(supportsEditMode("vault_page"), true);
  assert.equal(supportsEditMode("ink_page"), true, "an unknown kind is text, so it has both modes");
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
