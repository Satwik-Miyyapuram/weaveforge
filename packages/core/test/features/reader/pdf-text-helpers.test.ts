import { test } from "node:test";
import assert from "node:assert/strict";
import {
  furnitureKey,
  FURNITURE_MARGIN,
  isBoldFont,
  pageTextFromItems,
} from "../../../src/features/reader/analysis/line-reconstruction.js";
import * as citationText from "../../../src/features/reader/analysis/citation-text.js";
import * as reader from "../../../src/features/reader/index.js";

/**
 * The PDF text helpers live once, in line-reconstruction (04-06, 04-07, 04-09,
 * 04-10, xhelp-14). The outputs below were pinned against the copies before
 * they were folded together, so the move changes no reader behaviour.
 */

test("pageTextFromItems: runs joined, a newline after each hasEOL run", () => {
  assert.equal(pageTextFromItems([]), "");
  assert.equal(
    pageTextFromItems([{ str: "see " }, { str: "[12]", hasEOL: true }, { str: "" , hasEOL: true }, { str: "tail" }]),
    "see [12]\n\ntail",
  );
  assert.equal(pageTextFromItems([{ str: "a", hasEOL: false }, { str: "b", hasEOL: true }]), "ab\n");
});

test("pageTextFromItems: one copy, the one the package exports", () => {
  assert.equal(reader.pageTextFromItems, pageTextFromItems);
  assert.equal("pageTextFromItems" in citationText, false, "citation-text keeps no copy");
});

test("isBoldFont: bold, black and heavy faces, any case; nothing else", () => {
  for (const name of ["Times-Bold", "NimbusSan-BoldItalic", "Arial Black", "Roboto-Heavy", "CMBX10+bold"]) {
    assert.equal(isBoldFont(name), true, name);
  }
  for (const name of [undefined, "", "Times-Roman", "CMR10", "Helvetica-Oblique"]) {
    assert.equal(isBoldFont(name), false, String(name));
  }
});

test("furnitureKey: lower case, spaces collapsed, digits masked", () => {
  assert.equal(furnitureKey("Journal  of\tTests 12"), "journal of tests #");
  assert.equal(furnitureKey("Page 3 of 10"), "page # of #");
  assert.equal(furnitureKey("ABC"), "abc");
  assert.equal(FURNITURE_MARGIN, 0.06);
});

