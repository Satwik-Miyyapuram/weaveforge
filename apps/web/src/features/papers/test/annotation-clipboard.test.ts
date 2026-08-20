import assert from "node:assert/strict";
import test from "node:test";
import { formatQuoteCiteClipboard } from "../application/sync-annotation-excerpts";

test("formats multiline annotation text as a quote followed by a paper wikilink", () => {
  assert.equal(
    formatQuoteCiteClipboard("first\nsecond", "Paper title"),
    "> first\n> second\n\n[[Paper title]]\n",
  );
});

test("repairs the wrapping a PDF text layer puts in a highlight", () => {
  // What a highlight over two lines of a journal column actually contains.
  const fromPdf =
    "The findings suggest that long-term expo-\nsure has a measurable eﬀect on the out-\ncome in both groups.";
  assert.equal(
    formatQuoteCiteClipboard(fromPdf, "Higgins et al."),
    "> The findings suggest that long-term exposure has a measurable effect on the outcome in both groups.\n\n[[Higgins et al.]]\n",
  );
});

test("a hyphenated compound is not fused when the word resumes capitalised", () => {
  assert.equal(
    formatQuoteCiteClipboard(
      "we evaluate the standard Navier-\nStokes formulation against the alternative",
      "Paper",
    ),
    "> we evaluate the standard Navier-Stokes formulation against the alternative\n\n[[Paper]]\n",
  );
});

test("a paragraph break inside a highlight survives", () => {
  const twoParagraphs = "First claim ends here.\n\nSecond claim starts here.";
  assert.equal(
    formatQuoteCiteClipboard(twoParagraphs, "Paper"),
    "> First claim ends here.\n>\n> Second claim starts here.\n\n[[Paper]]\n",
  );
});
