import assert from "node:assert/strict";
import test from "node:test";
import {
  findQuoteMatches,
  normaliseWhitespace,
  pickNearestMatch,
  resolvePositionSelector,
  resolveTextAnchor,
  type PdfLocus,
  type TextPositionSelector,
  type TextQuoteSelector,
} from "../src/reader/index.js";

const quote = (partial: Omit<TextQuoteSelector, "type">): TextQuoteSelector => ({
  type: "TextQuoteSelector",
  ...partial,
});

const position = (start: number, end: number): TextPositionSelector => ({
  type: "TextPositionSelector",
  start,
  end,
});

test("findQuoteMatches returns every exact occurrence", () => {
  const text = "alpha beta alpha gamma";
  assert.deepEqual(findQuoteMatches(text, quote({ exact: "alpha" })), [
    { start: 0, end: 5 },
    { start: 11, end: 16 },
  ]);
});

test("findQuoteMatches applies prefix and suffix constraints", () => {
  const text = "xx foo yy foo zz";
  assert.deepEqual(
    findQuoteMatches(text, quote({ exact: "foo", prefix: "xx ", suffix: " yy" })),
    [{ start: 3, end: 6 }],
  );
  assert.deepEqual(
    findQuoteMatches(text, quote({ exact: "foo", prefix: "yy ", suffix: " zz" })),
    [{ start: 10, end: 13 }],
  );
});

test("findQuoteMatches returns empty for blank exact or no hit", () => {
  assert.deepEqual(findQuoteMatches("hello", quote({ exact: "" })), []);
  assert.deepEqual(findQuoteMatches("hello", quote({ exact: "nope" })), []);
});

test("pickNearestMatch chooses the span closest to stored position start", () => {
  const matches = [
    { start: 0, end: 5 },
    { start: 40, end: 45 },
    { start: 80, end: 85 },
  ];
  assert.deepEqual(pickNearestMatch(matches, position(42, 47)), { start: 40, end: 45 });
  assert.deepEqual(pickNearestMatch(matches, position(10, 15)), { start: 0, end: 5 });
});

test("pickNearestMatch keeps first on equal distance and without position", () => {
  const matches = [
    { start: 10, end: 15 },
    { start: 30, end: 35 },
  ];
  assert.deepEqual(pickNearestMatch(matches, position(20, 25)), { start: 10, end: 15 });
  assert.deepEqual(pickNearestMatch(matches, undefined), { start: 10, end: 15 });
  assert.equal(pickNearestMatch([], position(0, 1)), undefined);
});

test("resolvePositionSelector accepts in-bounds spans and rejects bad ones", () => {
  const text = "abcdefghij";
  assert.deepEqual(resolvePositionSelector(text, position(2, 5)), { start: 2, end: 5 });
  assert.deepEqual(resolvePositionSelector(text, position(0, 10)), { start: 0, end: 10 });
  assert.equal(resolvePositionSelector(text, position(5, 4)), null);
  assert.equal(resolvePositionSelector(text, position(-1, 2)), null);
  assert.equal(resolvePositionSelector(text, position(0, 11)), null);
});

test("resolveTextAnchor prefers quote match with high confidence", () => {
  const text = "The latent space encodes structure.";
  const locus: PdfLocus = {
    quote: quote({ exact: "latent space", prefix: "The ", suffix: " encodes" }),
    position: position(99, 111),
  };
  assert.deepEqual(resolveTextAnchor(text, locus), {
    start: 4,
    end: 16,
    via: "quote",
    confidence: "high",
  });
});

test("resolveTextAnchor disambiguates multiple quote hits via position", () => {
  const text = "foo one foo two foo three";
  const locus: PdfLocus = {
    quote: quote({ exact: "foo" }),
    position: position(8, 11),
  };
  assert.deepEqual(resolveTextAnchor(text, locus), {
    start: 8,
    end: 11,
    via: "quote",
    confidence: "high",
  });
});

test("resolveTextAnchor falls back to position with low confidence", () => {
  const text = "abcdefghij";
  const locus: PdfLocus = {
    quote: quote({ exact: "missing" }),
    position: position(2, 6),
  };
  assert.deepEqual(resolveTextAnchor(text, locus), {
    start: 2,
    end: 6,
    via: "position",
    confidence: "low",
  });
});

test("resolveTextAnchor returns null when neither quote nor position works", () => {
  const text = "short";
  const locus: PdfLocus = {
    quote: quote({ exact: "absent" }),
    position: position(0, 99),
  };
  assert.equal(resolveTextAnchor(text, locus), null);
  assert.equal(resolveTextAnchor(text, { quote: quote({ exact: "absent" }) }), null);
});

test("findQuoteMatches matches across a newline mid-phrase", () => {
  const text = "the latent\nspace encodes";
  const span = findQuoteMatches(text, quote({ exact: "latent space" }));
  assert.deepEqual(span, [{ start: 4, end: 16 }]);
  assert.equal(text.slice(span[0]!.start, span[0]!.end), "latent\nspace");
});

test("findQuoteMatches matches when text has doubled spaces", () => {
  const text = "latent  space";
  const span = findQuoteMatches(text, quote({ exact: "latent space" }));
  assert.deepEqual(span, [{ start: 0, end: 13 }]);
  assert.equal(text.slice(span[0]!.start, span[0]!.end), "latent  space");
});

test("findQuoteMatches ignores leading and trailing whitespace differences", () => {
  const text = "  latent space  ";
  const span = findQuoteMatches(
    text,
    quote({ exact: "  latent space  " }),
  );
  assert.deepEqual(span, [{ start: 2, end: 14 }]);
  assert.equal(text.slice(span[0]!.start, span[0]!.end), "latent space");
});

test("findQuoteMatches returns spans into the original non-normalised text", () => {
  const text = "alpha\tbeta\ngamma";
  const span = findQuoteMatches(text, quote({ exact: "beta gamma" }));
  assert.equal(span.length, 1);
  const { start, end } = span[0]!;
  assert.equal(text.slice(start, end), "beta\ngamma");
  assert.equal(start, 6);
  assert.equal(end, 16);
});

test("findQuoteMatches treats soft hyphen at line end as whitespace", () => {
  const text = "exam\u00AD\nple theory";
  const span = findQuoteMatches(text, quote({ exact: "exam ple" }));
  assert.deepEqual(span, [{ start: 0, end: 9 }]);
  assert.equal(text.slice(span[0]!.start, span[0]!.end), "exam\u00AD\nple");
});

test("normaliseWhitespace builds a map that recovers original slices", () => {
  const text = "  foo\n\tbar  ";
  const { normalised, map } = normaliseWhitespace(text);
  assert.equal(normalised, "foo bar");
  assert.equal(text.slice(map[0]!, map[normalised.length]!), "foo\n\tbar");
});

test("resolveTextAnchor quote path still wins under whitespace drift", () => {
  const text = "The latent\nspace encodes structure.";
  const locus: PdfLocus = {
    quote: quote({ exact: "latent space", prefix: "The ", suffix: " encodes" }),
    position: position(99, 111),
  };
  const resolved = resolveTextAnchor(text, locus);
  assert.deepEqual(resolved, {
    start: 4,
    end: 16,
    via: "quote",
    confidence: "high",
  });
  assert.equal(text.slice(resolved!.start, resolved!.end), "latent\nspace");
});
