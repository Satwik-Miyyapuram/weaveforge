import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Pins the Rust paper record rules to literal answers. Each expectation was
// worked out from the rule itself (the TS originals were removed from
// packages/core/src/features/papers/domain/{paper,paper-field}.ts), so a
// failure means the Rust rule moved.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

test("normalizeDoi trims, strips a doi.org prefix, and lowercases", () => {
  assert.equal(rs.normalizeDoi(undefined), undefined);
  assert.equal(rs.normalizeDoi(""), undefined);
  assert.equal(rs.normalizeDoi(" "), "");
  assert.equal(rs.normalizeDoi("https://doi.org/10.1/A"), "10.1/a");
  assert.equal(rs.normalizeDoi("  http://dx.doi.org/10.1/B  "), "10.1/b");
  assert.equal(rs.normalizeDoi("HTTPS://DOI.ORG/10.1000/XYZ"), "10.1000/xyz");
  assert.equal(rs.normalizeDoi("https://dx.doi.org/10.1000/ABC"), "10.1000/abc");
  assert.equal(rs.normalizeDoi("10.1000/ABC\t"), "10.1000/abc");
  assert.equal(rs.normalizeDoi("doi.org/10.1/A"), "doi.org/10.1/a");
});

test("normalizeTags drops a leading #, trims, lowercases, drops empties, and dedupes in order", () => {
  assert.deepEqual(rs.normalizeTags([]), []);
  assert.deepEqual(rs.normalizeTags(["#ML", " ml ", "##Vae", "", "  ", "#", "Ünï"]), ["ml", "vae", "ünï"]);
  assert.deepEqual(rs.normalizeTags(["　ML　"]), ["ml"]);
  assert.deepEqual(rs.normalizeTags(["b", "a", "b"]), ["b", "a"]);
});

test("extractHashtagRefs reads #tags with UTF-16 offsets", () => {
  assert.deepEqual(rs.extractHashtagRefs(undefined), []);
  assert.deepEqual(rs.extractHashtagRefs("no tags here"), []);
  // "é" and the space take indexes 0 and 1, so the '#' is at index 2.
  assert.deepEqual(rs.extractHashtagRefs("é #tag"), [{ tag: "tag", index: 2, length: 4 }]);
  // The emoji is two UTF-16 units, so the '#' is at index 3.
  assert.deepEqual(rs.extractHashtagRefs("🎉 #a"), [{ tag: "a", index: 3, length: 2 }]);
  // A doubled '#' reads the second one.
  assert.deepEqual(rs.extractHashtagRefs("Key #Tag and ##double"), [
    { tag: "tag", index: 4, length: 4 },
    { tag: "double", index: 14, length: 7 },
  ]);
  assert.deepEqual(rs.extractHashtagRefs("#über"), [{ tag: "über", index: 0, length: 5 }]);
});

test("extractHashtags returns normalized, deduped tags in order", () => {
  assert.deepEqual(rs.extractHashtags(""), []);
  assert.deepEqual(rs.extractHashtags(undefined), []);
  assert.deepEqual(
    rs.extractHashtags("Key #Disentanglement idea, see #beta-VAE and #beta-VAE again."),
    ["disentanglement", "beta-vae"],
  );
  assert.deepEqual(rs.extractHashtags("#a #a #b"), ["a", "b"]);
});

test("isEmptyPaperSummary treats missing, blank, and the placeholder as empty", () => {
  const cases: [string | null | undefined, boolean][] = [
    [null, true],
    [undefined, true],
    ["", true],
    [" ", true],
    [" \n", true],
    ["No summary yet.", true],
    ["  No summary yet.  ", true],
    ["no summary yet.", false],
    ["A summary.", false],
  ];
  for (const [summary, empty] of cases) {
    assert.equal(rs.isEmptyPaperSummary(summary), empty, JSON.stringify(summary));
  }
});

test("isPaperFieldKind and isQuotationType return the literal Rust answers", () => {
  const cases: [string, boolean, boolean][] = [
    ["text", true, false],
    ["number", true, false],
    ["select", true, false],
    ["multi_select", true, false],
    ["relation", true, false],
    ["rollup", true, false],
    ["direct", false, true],
    ["paraphrase", false, true],
    ["summary", false, true],
    ["", false, false],
    ["Text", false, false],
    ["rollup ", false, false],
    ["Direct", false, false],
    ["quote", false, false],
    ["__proto__", false, false],
  ];
  for (const [value, kind, quotation] of cases) {
    assert.equal(rs.isPaperFieldKind(value), kind, value);
    assert.equal(rs.isQuotationType(value), quotation, value);
  }
});

test("encodeRollupOptions writes rel, agg, and the optional src token", () => {
  assert.deepEqual(rs.encodeRollupOptions({ relationFieldId: "f1", agg: "count" }), ["rel:f1", "agg:count"]);
  assert.deepEqual(rs.encodeRollupOptions({ relationFieldId: "f1", agg: "sum", sourceFieldId: "s2" }), [
    "rel:f1",
    "agg:sum",
    "src:s2",
  ]);
});

test("parseRollupOptions reads the tokens back and refuses incomplete or unknown input", () => {
  const parse = (options: string[]) => JSON.parse(JSON.stringify(rs.parseRollupOptions(options)));
  assert.deepEqual(parse(["rel:f1", "agg:sum", "src:s2"]), { relationFieldId: "f1", agg: "sum", sourceFieldId: "s2" });
  assert.deepEqual(parse(["rel:f1", "agg:count"]), { relationFieldId: "f1", agg: "count" });
  // The last token of a kind wins.
  assert.deepEqual(parse(["rel:f1", "rel:f2", "agg:sum", "agg:avg"]), { relationFieldId: "f2", agg: "avg" });
  // Refused: no relation, unknown or wrongly-cased aggregate, or an unknown prefix.
  assert.equal(rs.parseRollupOptions(["agg:avg"]), null);
  assert.equal(rs.parseRollupOptions(["rel:", "agg:count"]), null);
  assert.equal(rs.parseRollupOptions(["rel:f1", "agg:median"]), null);
  assert.equal(rs.parseRollupOptions(["rel:f1", "agg:COUNT"]), null);
  assert.equal(rs.parseRollupOptions(["REL:f1", "agg:sum"]), null);
  assert.equal(rs.parseRollupOptions([]), null);
});

test("coercePaperFieldValue follows JS Number() for number fields and clears blanks", () => {
  // Absent, blank text and an empty list clear the value.
  assert.equal(rs.coercePaperFieldValue("text", null), null);
  assert.equal(rs.coercePaperFieldValue("text", "   "), null);
  assert.equal(rs.coercePaperFieldValue("relation", []), null);
  // Text and select are trimmed; a number or list is refused.
  assert.equal(rs.coercePaperFieldValue("select", "  VAE  "), "VAE");
  assert.throws(() => rs.coercePaperFieldValue("text", 1), /expects a string/);
  // Number reads text the way JS Number() does.
  assert.equal(rs.coercePaperFieldValue("number", " 1.5 "), 1.5);
  assert.equal(rs.coercePaperFieldValue("number", "0x1F"), 31);
  assert.equal(rs.coercePaperFieldValue("number", "0b101"), 5);
  assert.equal(rs.coercePaperFieldValue("number", ["5"]), 5);
  assert.equal(rs.coercePaperFieldValue("number", [""]), 0);
  assert.equal(rs.coercePaperFieldValue("number", 2), 2);
  assert.throws(() => rs.coercePaperFieldValue("number", "-0x1F"), /finite number/);
  assert.throws(() => rs.coercePaperFieldValue("number", "Infinity"), /finite number/);
  assert.throws(() => rs.coercePaperFieldValue("number", ["1", "2"]), /finite number/);
  // Multi-select trims, drops blanks and repeats.
  assert.deepEqual(rs.coercePaperFieldValue("multi_select", [" a ", "a", "", "b"]), ["a", "b"]);
  // Rollup is computed and refused.
  assert.throws(() => rs.coercePaperFieldValue("rollup", "x"), /read-only/);
});
