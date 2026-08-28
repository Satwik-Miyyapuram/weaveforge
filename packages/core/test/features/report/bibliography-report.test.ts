import assert from "node:assert/strict";
import test from "node:test";
import { parseBibEntries } from "../../../src/features/report/domain/bib-entries.js";
import {
  checkBibliography,
  type BibFinding,
  type BibFindingKind,
} from "../../../src/features/report/domain/bibliography-report.js";

function report(files: { path: string; content: string }[]) {
  return checkBibliography({ sources: files, bibliography: parseBibEntries(files) });
}

const kinds = (findings: BibFinding[]): BibFindingKind[] => findings.map((f) => f.kind);
const of = (findings: BibFinding[], kind: BibFindingKind) => findings.filter((f) => f.kind === kind);

const COMPLETE = "@article{ok,\n  author = {Smith, Jane},\n  title = {T},\n  journal = {J},\n  year = {2020}\n}";

test("a key cited with no entry is an error, once per file", () => {
  const result = report([
    {
      path: "main.tex",
      content: "\\cite{ghost} and \\citep{ghost} again.\n\\bibliography{refs}",
    },
    { path: "refs.bib", content: COMPLETE },
  ]);

  const missing = of(result.findings, "cited-not-defined");
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.key, "ghost");
  assert.equal(missing[0]?.severity, "error");
  assert.equal(missing[0]?.line, 1);
});

test("an entry nobody cites is a warning, and \\nocite{*} settles it", () => {
  const files = [
    { path: "main.tex", content: "Nothing cited here.\n\\bibliography{refs}" },
    { path: "refs.bib", content: COMPLETE },
  ];

  assert.deepEqual(kinds(of(report(files).findings, "defined-not-cited")), ["defined-not-cited"]);

  const everything = report([
    { path: "main.tex", content: "\\nocite{*}\n\\bibliography{refs}" },
    { path: "refs.bib", content: COMPLETE },
  ]);
  assert.equal(everything.citesEverything, true);
  assert.deepEqual(of(everything.findings, "defined-not-cited"), []);
});

test("a commented-out citation does not keep an entry alive", () => {
  const result = report([
    { path: "main.tex", content: "% \\cite{ok} was here\n100\\% done\n\\bibliography{refs}" },
    { path: "refs.bib", content: COMPLETE },
  ]);

  assert.equal(of(result.findings, "defined-not-cited").length, 1);
  assert.deepEqual(result.citedKeys, []);
});

test("a duplicate key names the definition that wins", () => {
  const result = report([
    { path: "main.tex", content: "\\cite{ok}\n\\bibliography{refs}" },
    { path: "refs.bib", content: `${COMPLETE}\n@misc{ok, title = {Second}}` },
  ]);

  const duplicate = of(result.findings, "duplicate-key")[0];
  assert.equal(duplicate?.severity, "error");
  assert.match(duplicate?.message ?? "", /already defined at refs\.bib:1/);
});

test("required fields follow the entry type, and biblatex spellings count", () => {
  const result = report([
    { path: "main.tex", content: "\\cite{a}\\cite{b}\\cite{c}\n\\bibliography{refs}" },
    {
      path: "refs.bib",
      content: [
        "@article{a, author = {X, Y}, title = {T}, journaltitle = {J}, date = {2021}}",
        "@inproceedings{b, author = {X, Y}, title = {T}, year = {2021}}",
        "@misc{c}",
      ].join("\n"),
    },
  ]);

  const missing = of(result.findings, "missing-field");
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.match(missing[0]?.message ?? "", /'b' has no 'booktitle'/);
});

test("a DOI keeps its shape with or without the resolver in front", () => {
  const result = report([
    { path: "main.tex", content: "\\cite{good}\\cite{bad}\n\\bibliography{refs}" },
    {
      path: "refs.bib",
      content: [
        "@misc{good, title = {T}, doi = {https://doi.org/10.1000/abc.123}}",
        "@misc{bad, title = {T}, doi = {not-a-doi}}",
      ].join("\n"),
    },
  ]);

  const doi = of(result.findings, "malformed-doi");
  assert.equal(doi.length, 1);
  assert.equal(doi[0]?.key, "bad");
});

test("the minority author style is the one reported", () => {
  const result = report([
    { path: "main.tex", content: "\\nocite{*}\n\\bibliography{refs}" },
    {
      path: "refs.bib",
      content: [
        "@misc{one, title = {T}, author = {Smith, Jane}}",
        "@misc{two, title = {T}, author = {Doe, John and Roe, Ann}}",
        "@misc{three, title = {T}, author = {Ada Lovelace}}",
      ].join("\n"),
    },
  ]);

  const style = of(result.findings, "author-format");
  assert.equal(style.length, 1);
  assert.equal(style[0]?.key, "three");
  assert.match(style[0]?.message ?? "", /'Last, First'/);
});

test("a bibliography file the document names but does not contain is an error", () => {
  const result = report([
    { path: "main.tex", content: "\\nocite{*}\n\\addbibresource{missing.bib}" },
    { path: "refs.bib", content: COMPLETE },
  ]);

  const missing = of(result.findings, "missing-bib-file");
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.line, 2);
});

test("a clean project reports nothing at all", () => {
  const result = report([
    { path: "main.tex", content: "\\cite{ok}\n\\bibliography{refs}" },
    { path: "refs.bib", content: COMPLETE },
  ]);

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.citedKeys, ["ok"]);
  assert.equal(result.entryCount, 1);
});

test("errors sort before warnings", () => {
  const result = report([
    { path: "main.tex", content: "\\cite{ghost}\n\\bibliography{refs}" },
    { path: "refs.bib", content: COMPLETE },
  ]);

  assert.deepEqual(kinds(result.findings), ["cited-not-defined", "defined-not-cited"]);
});
