import assert from "node:assert/strict";
import test from "node:test";
import { encodeLocus, decodeLocus, type PdfLocus } from "../../src/reader/index.js";

const locus: PdfLocus = {
  quote: { type: "TextQuoteSelector", exact: "attention is all you need", prefix: "we show ", suffix: "." },
  position: { type: "TextPositionSelector", start: 100, end: 126 },
};

test("encodeLocus round-trips through decodeLocus", () => {
  const decoded = decodeLocus(encodeLocus(locus));
  assert.deepEqual(decoded, locus);
});

test("encodeLocus round-trips quotes that contain percent signs", () => {
  const withPct: PdfLocus = {
    quote: { type: "TextQuoteSelector", exact: "accuracy was 50%" },
  };
  const viaParams = new URLSearchParams({ locus: encodeLocus(withPct) }).get("locus");
  assert.deepEqual(decodeLocus(viaParams), withPct);
  assert.deepEqual(decodeLocus(encodeURIComponent(encodeLocus(withPct))), withPct);
});

test("encodeLocus omits absent optional fields", () => {
  const bare: PdfLocus = { quote: { type: "TextQuoteSelector", exact: "x" } };
  const decoded = decodeLocus(encodeLocus(bare));
  assert.deepEqual(decoded, bare);
});

test("decodeLocus rejects malformed or empty input", () => {
  assert.equal(decodeLocus(null), null);
  assert.equal(decodeLocus(""), null);
  assert.equal(decodeLocus("%%%not-json"), null);
  assert.equal(decodeLocus(encodeURIComponent(JSON.stringify({ quote: {} }))), null);
  assert.equal(
    decodeLocus(encodeURIComponent(JSON.stringify({ quote: { type: "TextQuoteSelector", exact: "" } }))),
    null,
  );
});

test("decodeLocus drops an invalid position but keeps the quote", () => {
  const raw = encodeURIComponent(
    JSON.stringify({
      quote: { type: "TextQuoteSelector", exact: "keep me" },
      position: { type: "Nope", start: "a" },
    }),
  );
  assert.deepEqual(decodeLocus(raw), {
    quote: { type: "TextQuoteSelector", exact: "keep me" },
  });
});

test("decodeLocus rejects oversized or mistyped quote/position fields", () => {
  assert.equal(decodeLocus("x".repeat(9000)), null);
  assert.equal(
    decodeLocus(
      JSON.stringify({
        quote: { type: "TextQuoteSelector", exact: "ok", prefix: 12 },
      }),
    ),
    null,
  );
  assert.deepEqual(
    decodeLocus(
      JSON.stringify({
        quote: { type: "TextQuoteSelector", exact: "ok" },
        position: { type: "TextPositionSelector", start: 5, end: 1 },
      }),
    ),
    {
      quote: { type: "TextQuoteSelector", exact: "ok" },
    },
  );
});
