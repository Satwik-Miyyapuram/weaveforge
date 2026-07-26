import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_CITATION_FORMATS,
  citationFormatStorageKey,
  parseEditorCitationFormat,
} from "../citation-format-preference";

test("parseEditorCitationFormat falls back to wikilink for unknown values", () => {
  assert.equal(parseEditorCitationFormat("pandoc"), "pandoc");
  assert.equal(parseEditorCitationFormat("latex"), "latex");
  assert.equal(parseEditorCitationFormat("nonsense"), "wikilink");
  assert.equal(parseEditorCitationFormat(undefined), "wikilink");
  assert.equal(parseEditorCitationFormat(42), "wikilink");
});

test("every known format round-trips through the parser", () => {
  for (const format of EDITOR_CITATION_FORMATS) {
    assert.equal(parseEditorCitationFormat(format), format);
  }
});

test("storage key is per-project and stable for the global scope", () => {
  assert.equal(citationFormatStorageKey("p1"), "thesis.citeFormat.p1");
  assert.equal(citationFormatStorageKey(null), "thesis.citeFormat.global");
  assert.equal(citationFormatStorageKey(undefined), "thesis.citeFormat.global");
});
