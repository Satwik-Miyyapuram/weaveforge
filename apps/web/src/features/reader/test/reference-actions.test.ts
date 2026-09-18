import { test } from "node:test";
import assert from "node:assert/strict";
import type { NewPaperInput, NewPaperRelationInput, Paper, PaperRef, PaperStatus } from "@weaveforge/core";
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
  listItems: { listId: string; paperId: string }[];
  manual: NewPaperInput[];
}

function makeActions(paper: Partial<Paper> = {}) {
  const calls: Calls = { refs: [], relations: [], listItems: [], manual: [] };
  const actions = createReferenceActions({
    importPaper: {
      async fromRef(ref, status) {
        calls.refs.push({ ref, ...(status ? { status } : {}) });
        return { id: "new-paper", title: "Attention is all you need", ...paper } as Paper;
      },
    },
    addPaper: {
      async addManual(input) {
        calls.manual.push(input);
        return { id: "new-paper", title: input.title } as Paper;
      },
    },
    lists: {
      async addPaperToList(listId, paperId) {
        calls.listItems.push({ listId, paperId });
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

test("read later imports the reference as to_read, not as unread junk", async () => {
  const { actions, calls } = makeActions();
  const paper = await actions.readLater(entry);
  assert.equal(paper.id, "new-paper");
  assert.equal(calls.refs[0]?.status, "to_read");
  assert.equal(calls.refs[0]?.ref.kind, "bibliographic");
});

test("add to list imports the paper first, then links it to the list", async () => {
  const { actions, calls } = makeActions();
  await actions.addToList(entry, "list-9");
  assert.deepEqual(calls.listItems, [{ listId: "list-9", paperId: "new-paper" }]);
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
  await assert.rejects(() => actions.linkPapers("paper-a", "paper-a"), /cannot cite itself/);
  assert.equal(calls.relations.length, 0);
});