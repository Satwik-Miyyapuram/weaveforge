import { test } from "node:test";
import assert from "node:assert/strict";
import { ValidationError, type NewPaperInput, type NewPaperRelationInput, type Paper, type PaperRef, type PaperStatus } from "@weaveforge/core";
import { createReferenceActions, manualInputFromReference, referenceRef } from "../application/reference-actions";

const entry = {
  index: 12,
  label: "[12]",
  raw: "Vaswani et al. Attention is all you need. NeurIPS, 2017.",
  page: 9,
  x: 40,
  y: 600,
  authors: ["Vaswani", "Shazeer"],
  year: 2017,
  title: "Attention is all you need",
};

interface Calls {
  refs: { ref: PaperRef; status?: PaperStatus }[];
  relations: NewPaperRelationInput[];
  manual: NewPaperInput[];
}

function makeActions(paper: Partial<Paper> = {}) {
  const calls: Calls = { refs: [], relations: [], manual: [] };
  const actions = createReferenceActions({
    importPaper: {
      async importRef(ref, status) {
        calls.refs.push({ ref, ...(status ? { status } : {}) });
        return { paper: { id: "new-paper", title: "Attention is all you need", ...paper } as Paper, created: true };
      },
    },
    addPaper: {
      async add(input) {
        calls.manual.push(input);
        return { paper: { id: "new-paper", title: input.title } as Paper, created: true };
      },
    },
    relations: {
      async add(input) {
        calls.relations.push(input);
      },
    },
  });
  return { actions, calls };
}

test("a DOI is preferred over the title, so resolution is a hit rather than a search", () => {
  assert.deepEqual(referenceRef({ ...entry, doi: "10.5555/attention" }), {
    kind: "doi",
    value: "10.5555/attention",
  });
});

test("an arXiv id is used when there is no DOI", () => {
  assert.deepEqual(referenceRef({ ...entry, arxivId: "1706.03762" }), {
    kind: "arxiv",
    value: "1706.03762",
  });
});

test("a title-only entry searches bibliographically, carrying its hints", () => {
  assert.deepEqual(referenceRef(entry), {
    kind: "bibliographic",
    value: "Attention is all you need",
    hints: { title: "Attention is all you need", year: 2017, firstAuthor: "Vaswani" },
  });
});

test("an entry with no title at all falls back to its raw text", () => {
  const { title, ...noTitle } = entry;
  assert.deepEqual(referenceRef({ ...noTitle, raw: "Some unparsed reference" }), {
    kind: "bibliographic",
    value: "Some unparsed reference",
    hints: { year: 2017, firstAuthor: "Vaswani" },
  });
});

test("add to library imports the reference with the library's default status", async () => {
  const { actions, calls } = makeActions();
  const { paper } = await actions.addToLibrary(entry);
  assert.equal(paper.id, "new-paper");
  assert.equal(calls.refs[0]?.status, undefined);
  assert.equal(calls.refs[0]?.ref.kind, "bibliographic");
});

test("add manually never invents fields the entry did not carry", () => {
  const input = manualInputFromReference(entry);
  assert.deepEqual(input, {
    title: "Attention is all you need",
    status: "to_read",
    authors: ["Vaswani", "Shazeer"],
    year: 2017,
  });
  assert.equal("doi" in input, false);
  assert.equal("arxivId" in input, false);
});

test("add manually keeps a usable title when parsing found none", () => {
  const { title, ...noTitle } = entry;
  const input = manualInputFromReference({ ...noTitle, raw: "x".repeat(400) });
  assert.equal(input.title.length, 200);
});

test("link papers records the direction as citing → cited, marked manual", async () => {
  const { actions, calls } = makeActions();
  await actions.linkPapers("paper-a", "paper-b");
  assert.deepEqual(calls.relations, [
    { fromPaper: "paper-a", toPaper: "paper-b", relation: "cites", source: "manual" },
  ]);
});

test("linking a paper to itself is refused before it reaches the use-case", async () => {
  const { actions, calls } = makeActions();
  await assert.rejects(() => actions.linkPapers("paper-a", "paper-a"), (err) =>
    err instanceof ValidationError && /cannot cite itself/.test(err.message));
  assert.equal(calls.relations.length, 0);
});
// The popover shows the record the lookup found. Adding has to add that record:
// a second title search can land on a different paper (or on one already in the
// library), and the entry then reads "in library" for a paper it never cited.
test("adding a resolved entry adds the record the popover showed, without a second search", async () => {
  const { actions, calls } = makeActions();
  const metadata = { title: "Deep Sparse Rectifier Neural Networks", authors: ["X. Glorot"], year: 2011 };
  await actions.addToLibrary(entry, metadata);
  assert.equal(calls.refs.length, 0);
  assert.deepEqual(calls.manual, [metadata]);
});

test("the result says when the paper was already in the library", async () => {
  const actions = createReferenceActions({
    importPaper: { async importRef() { return { paper: { id: "old" } as Paper, created: false }; } },
    addPaper: { async add() { return { paper: { id: "old" } as Paper, created: false }; } },
    relations: { async add() {} },
  });
  assert.equal((await actions.addToLibrary(entry)).created, false);
  assert.equal((await actions.addManually(entry)).created, false);
});
