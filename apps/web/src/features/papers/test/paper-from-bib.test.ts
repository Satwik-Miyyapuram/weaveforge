/**
 * A `.bib` export (Zotero, Mendeley, Google Scholar, Paperpile) becomes papers.
 * The Rust core reads the file and leaves out what the library has by DOI or
 * citation key; these tests run the real core and check what gets saved, what
 * is skipped and what is reported broken.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddPaperResult, NewPaperInput, Paper } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { RustCore } from "@/lib/rust-core";
import { bibImportMessage, importBibFile, splitPaperDrop, type BibImportDeps } from "../application/parts-2";

let core: RustCore;
before(async () => { core = await loadTestCore(); });

const BIB = `@article{smith2020,
  title = {Caf{\\'e} Networks},
  author = {Smith, Jane and Doe, John},
  year = {2020},
  journal = {Journal of Things},
  doi = {10.1000/ABC},
}

@inproceedings{lee2021,
  title = {Second Paper},
  author = {Lee, Kim},
  year = 2021,
  booktitle = {Proc. of Stuff},
}

@misc{notitle,
  author = {Nobody},
}

@article{old2019,
  title = {Already Here},
  doi = {10.1000/old},
}
`;

const file = (text: string, name = "library.bib") => ({ name, text: async () => text });
const paper = (id: string, over: Partial<Paper> = {}) => ({ id, title: id, metadata: {}, ...over }) as Paper;

function deps(library: Paper[] = [], over: Partial<BibImportDeps> = {}) {
  const added: NewPaperInput[] = [];
  const after: string[] = [];
  const d: BibImportDeps = {
    plan: (name, text, dois, keys) => core.planBibImport(name, text, dois, keys),
    listPapers: async () => library,
    add: async (input): Promise<AddPaperResult> => {
      added.push(input);
      return { paper: paper(`p${added.length}`, { title: input.title }), created: true };
    },
    afterCreate: async (p) => { after.push(p.id); },
    ...over,
  };
  return { d, added, after };
}

test("saves each new entry with its fields, citation key and BibTeX", async () => {
  const { d, added, after } = deps([paper("x", { doi: "10.1000/old" })]);
  const out = await importBibFile(file(BIB), d);
  assert.deepEqual(added.map((a) => a.title), ["Café Networks", "Second Paper"]);
  const first = added[0]!;
  assert.deepEqual(first.authors, ["Jane Smith", "John Doe"]);
  assert.equal(first.year, 2020);
  assert.equal(first.venue, "Journal of Things");
  assert.equal(first.doi, "10.1000/abc");
  assert.deepEqual(first.metadata, { citeKey: "smith2020" });
  assert.match(first.bibtex ?? "", /@article\{smith2020,/);
  // Absent fields stay absent, not null.
  assert.equal(added[1]!.doi, undefined);
  assert.equal(added[1]!.abstract, undefined);
  assert.deepEqual(after, ["p1", "p2"]);
  assert.equal(out.added.length, 2);
  assert.deepEqual(out.skipped.map((s) => s.key), ["old2019"]);
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0]!.reason, /notitle has no title/);
  assert.equal(bibImportMessage(out), "Added 2 papers, skipped 1 already in the library, 1 could not be read.");
});

test("an existing citation key is skipped, case-insensitively", async () => {
  const { d, added } = deps([paper("x", { metadata: { citeKey: "LEE2021" } })]);
  const out = await importBibFile(file(BIB), d);
  assert.ok(!added.some((a) => a.title === "Second Paper"));
  assert.ok(out.skipped.some((s) => s.key === "lee2021" && s.line === 9));
});

test("a paper the add dedupes (same title) is skipped, not counted as added", async () => {
  const { d, after } = deps([], {
    add: async (input) => ({ paper: paper("dup", { title: input.title }), created: false }),
  });
  const out = await importBibFile(file(BIB), d);
  assert.equal(out.added.length, 0);
  assert.deepEqual(after, []);
  assert.ok(out.skipped.some((s) => s.key === "smith2020" && /Already in the library/.test(s.reason)));
});

test("one failed save is reported and the rest still import", async () => {
  let n = 0;
  const { d } = deps([], {
    add: async (input) => {
      n += 1;
      if (n === 1) throw new Error("disk full");
      return { paper: paper(`p${n}`, { title: input.title }), created: true };
    },
  });
  const out = await importBibFile(file(BIB), d);
  assert.deepEqual(out.added.map((p) => p.title), ["Second Paper", "Already Here"]);
  assert.ok(out.problems.some((p) => p.key === "smith2020" && p.reason === "disk full" && p.line === 1));
});

test("an empty or garbage file adds nothing and says so", async () => {
  const { d, added } = deps();
  const out = await importBibFile(file("not a bib file at all"), d);
  assert.equal(added.length, 0);
  assert.equal(bibImportMessage(out).startsWith("Added 0 papers"), true);
});

test("a drop on Papers sends .bib files to the import and the rest to the PDF add", () => {
  const files = [{ name: "a.pdf" }, { name: "refs.BIB" }, { name: "b.bibtex" }, { name: "notes.txt" }, { name: "c.pdf" }];
  const { pdfs, bibs } = splitPaperDrop(files);
  assert.deepEqual(pdfs.map((f) => f.name), ["a.pdf", "notes.txt", "c.pdf"], "a non-PDF still goes the PDF way, which counts it as skipped");
  assert.deepEqual(bibs.map((f) => f.name), ["refs.BIB", "b.bibtex"]);
});
