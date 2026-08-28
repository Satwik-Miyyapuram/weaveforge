import assert from "node:assert/strict";
import test from "node:test";
import { parseBibEntries } from "../../../src/features/report/domain/bib-entries.js";

const bib = (content: string) => [{ path: "refs.bib", content }];

test("reads type, key, fields and the line each entry starts on", () => {
  const result = parseBibEntries(
    bib(
      [
        "% a comment line",
        "@Article{smith2020,",
        "  title  = {Cost {AND} Benefit},",
        '  author = "Smith, Jane and Doe, John",',
        "  year   = 2020,",
        "}",
        "",
        "@misc{lone}",
      ].join("\n"),
    ),
  );

  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries.length, 2);
  const [article, lone] = result.entries;
  assert.equal(article?.type, "article");
  assert.equal(article?.key, "smith2020");
  assert.equal(article?.line, 2);
  assert.equal(article?.fields["title"], "Cost {AND} Benefit");
  assert.equal(article?.fields["author"], "Smith, Jane and Doe, John");
  assert.equal(article?.fields["year"], "2020");
  assert.equal(lone?.key, "lone");
  assert.deepEqual(lone?.fields, {});
});

test("a comma inside braces or quotes does not start a new field", () => {
  const [entry] = parseBibEntries(
    bib('@book{k,\n  title = {A, B and C},\n  note = "one, two",\n  year = {1999}\n}'),
  ).entries;

  assert.equal(entry?.fields["title"], "A, B and C");
  assert.equal(entry?.fields["note"], "one, two");
  assert.equal(entry?.fields["year"], "1999");
});

test("@string, @preamble and @comment declare no reference", () => {
  const result = parseBibEntries(
    bib('@string{acm = "ACM"}\n@preamble{" \\newcommand{\\x}{y} "}\n@comment{ignored}\n@misc{real}'),
  );

  assert.deepEqual(
    result.entries.map((entry) => entry.key),
    ["real"],
  );
});

test("an unclosed entry is a warning, not a thrown error", () => {
  const result = parseBibEntries(bib("@article{broken,\n  title = {No closing brace"));

  assert.deepEqual(result.entries, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]?.message ?? "", /never closed/);
  assert.equal(result.warnings[0]?.line, 1);
});

test("a repeated field is reported and the later value wins", () => {
  const result = parseBibEntries(bib("@misc{k,\n  title = {First},\n  title = {Second}\n}"));

  assert.equal(result.entries[0]?.fields["title"], "Second");
  assert.match(result.warnings[0]?.message ?? "", /names 'title' twice/);
});

test("an entry with no key is reported rather than stored under an empty name", () => {
  const result = parseBibEntries(bib("@article{,\n  title = {Anonymous}\n}"));

  assert.deepEqual(result.entries, []);
  assert.match(result.warnings[0]?.message ?? "", /no citation key/);
});

test("only .bib files are read", () => {
  const result = parseBibEntries([
    { path: "main.tex", content: "@article{fromtex, title = {Not a bibliography}}" },
    { path: "sub/refs.BIB", content: "@article{frombib, title = {Yes}}" },
  ]);

  assert.deepEqual(
    result.entries.map((entry) => entry.key),
    ["frombib"],
  );
});
