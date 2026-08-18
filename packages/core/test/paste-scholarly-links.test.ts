import { test } from "node:test";
import assert from "node:assert/strict";
import { linkScholarlyIdentifiers } from "../src/paste/scholarly-links.js";
import { cleanPastedText } from "../src/paste/clean-pasted-text.js";
import { DEFAULT_PASTE_SETTINGS } from "../src/paste/paste-settings.js";

const link = (text: string) => linkScholarlyIdentifiers(text).text;

test("a bare DOI becomes a link that keeps the identifier as its label", () => {
  assert.equal(
    link("See 10.1145/3292500.3330701 for the method."),
    "See [10.1145/3292500.3330701](https://doi.org/10.1145/3292500.3330701) for the method.",
  );
});

test("sentence punctuation is not part of the identifier", () => {
  assert.equal(
    link("as in 10.1038/nature12373."),
    "as in [10.1038/nature12373](https://doi.org/10.1038/nature12373).",
  );
  assert.equal(
    link("(see 10.1038/nature12373)"),
    "(see [10.1038/nature12373](https://doi.org/10.1038/nature12373))",
  );
});

test("a DOI with balanced parentheses keeps them", () => {
  // Wiley's older DOIs really are shaped like this.
  const doi = "10.1002/(SICI)1097-0258(19980815)17:15";
  assert.equal(link(doi), `[${doi}](https://doi.org/${doi})`);
});

test("an arXiv id is linked only with its prefix", () => {
  assert.equal(
    link("arXiv:1706.03762 is the one"),
    "[arXiv:1706.03762](https://arxiv.org/abs/1706.03762) is the one",
  );
  assert.equal(
    link("arXiv:math.GT/0309136"),
    "[arXiv:math.GT/0309136](https://arxiv.org/abs/math.GT/0309136)",
  );
  // A bare number is a decimal as readily as an identifier, and a note about
  // measurements is full of decimals.
  assert.equal(link("the value 1706.03762 was measured"), "the value 1706.03762 was measured");
});

test("an identifier already inside a link or a URL is left alone", () => {
  for (const text of [
    "https://doi.org/10.1145/3292500.3330701",
    "[the paper](https://doi.org/10.1145/3292500.3330701)",
    "[10.1145/3292500.3330701](https://doi.org/10.1145/3292500.3330701)",
    "see https://arxiv.org/abs/1706.03762 and arXiv",
  ]) {
    assert.equal(cleanPastedText(text, DEFAULT_PASTE_SETTINGS).text, text, text);
  }
});

test("code, maths and frontmatter are not touched", () => {
  for (const text of [
    "`10.1145/3292500.3330701`",
    "```\n10.1145/3292500.3330701\n```",
    "$10.1145/3292500.3330701$",
    "---\ndoi: 10.1145/3292500.3330701\n---\n\nbody",
  ]) {
    assert.equal(link(text), text, text);
  }
});

test("a version number is not a DOI", () => {
  for (const text of ["10.2/beta", "v10.1145/x", "/10.1145/3292500", "110.1145/3292500"]) {
    assert.equal(link(text), text, text);
  }
});

test("several identifiers in one paste are all linked", () => {
  const result = linkScholarlyIdentifiers(
    "10.1038/nature12373 and arXiv:1706.03762 and 10.1145/3292500.3330701",
  );
  assert.equal(result.count, 3);
  assert.equal(result.text.match(/\]\(https:\/\//g)?.length, 3);
});

test("the pipeline links on paste, and the switch turns it off", () => {
  const pasted = "See 10.1038/nature12373 now";
  assert.equal(
    cleanPastedText(pasted, DEFAULT_PASTE_SETTINGS).text,
    "See [10.1038/nature12373](https://doi.org/10.1038/nature12373) now",
  );
  assert.equal(
    cleanPastedText(pasted, { ...DEFAULT_PASTE_SETTINGS, linkIdentifiers: false }).text,
    pasted,
  );
});

test("linking is idempotent", () => {
  const once = link("See 10.1038/nature12373 and arXiv:1706.03762.");
  assert.equal(link(once), once);
  assert.equal(cleanPastedText(once, DEFAULT_PASTE_SETTINGS).text, once);
});
