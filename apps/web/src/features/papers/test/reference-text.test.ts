/** A paper as a reference ready to paste (APA style) and the copy action. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Paper, PaperSummary } from "@weaveforge/core";
import { formatReference } from "../domain/reference-text";
import { copyPaperAs } from "../ui/copy-paper";

function paper(over: Partial<Paper> = {}): Paper {
  return {
    id: "p1",
    title: "Attention is all you need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    year: 2017,
    venue: "Advances in Neural Information Processing Systems",
    doi: "10.5555/3295222.3295349",
    status: "read",
    tags: [],
    metadata: {},
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

test("authors, year, title, venue and DOI link", () => {
  assert.equal(
    formatReference(paper()),
    "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. " +
      "Advances in Neural Information Processing Systems. https://doi.org/10.5555/3295222.3295349",
  );
});

test("one author, two authors", () => {
  assert.match(formatReference(paper({ authors: ["Ann Lee"] })), /^Lee, A\. \(2017\)/);
  assert.match(formatReference(paper({ authors: ["Ann Lee", "Bo Chen"] })), /^Lee, A\., & Chen, B\. \(2017\)/);
});

test("names already as 'Last, First' and middle names", () => {
  assert.match(formatReference(paper({ authors: ["Lee, Ann Marie"] })), /^Lee, A\. M\. \(2017\)/);
  assert.match(formatReference(paper({ authors: ["Ann Marie Lee"] })), /^Lee, A\. M\. \(2017\)/);
});

test("a single-word name stays as it is", () => {
  assert.match(formatReference(paper({ authors: ["OpenAI"] })), /^OpenAI\. \(2017\)/);
});

test("no authors starts with the title; no year says n.d.", () => {
  assert.equal(
    formatReference(paper({ authors: [], year: undefined, venue: undefined, doi: undefined })),
    "Attention is all you need. (n.d.).",
  );
});

test("title ending in ? or ! keeps its own mark", () => {
  assert.match(formatReference(paper({ title: "Is it?", venue: undefined, doi: undefined })), /\(2017\)\. Is it\?$/);
});

test("more than 20 authors: first 19, …, last", () => {
  const many = Array.from({ length: 25 }, (_, i) => `Ann Person${i + 1}`);
  const ref = formatReference(paper({ authors: many }));
  assert.match(ref, /Person19, A\., \. \. \. Person25, A\. \(2017\)/);
  assert.ok(!ref.includes("Person20,"));
});

test("link falls back to arXiv, then url; doi prefix and blanks cleaned", () => {
  assert.match(formatReference(paper({ doi: undefined, arxivId: "arXiv:1706.03762" })), / https:\/\/arxiv\.org\/abs\/1706\.03762$/);
  assert.match(formatReference(paper({ doi: undefined, url: "https://x.org/a" })), / https:\/\/x\.org\/a$/);
  assert.match(formatReference(paper({ doi: "https://doi.org/10.1/abc" })), / https:\/\/doi\.org\/10\.1\/abc$/);
  assert.match(formatReference(paper({ doi: "  ", venue: "  " })), /need\.$/);
});

test("copyPaperAs reads the full row for a card summary, then copies", async () => {
  const summary: PaperSummary = { id: "p1", title: "T", authors: ["Ann Lee"], status: "read", tags: [], createdAt: "", updatedAt: "" };
  const wrote: string[] = [];
  const messages: string[] = [];
  await copyPaperAs("reference", summary, {
    getPaper: async () => paper({ title: "T", authors: ["Ann Lee"], venue: undefined, doi: undefined }),
    copy: async (text, message) => void (wrote.push(text), messages.push(message)),
  });
  assert.deepEqual(wrote, ["Lee, A. (2017). T."]);
  assert.deepEqual(messages, ["Reference copied"]);
});

test("copyPaperAs bibtex uses the paper's cite key", async () => {
  const wrote: string[] = [];
  await copyPaperAs("bibtex", paper(), {
    getPaper: async () => assert.fail("a full paper is not re-read"),
    copy: async (text) => void wrote.push(text),
  });
  assert.match(wrote[0]!, /^@inproceedings\{vaswani2017attention,|^@\w+\{\w+,/);
  assert.match(wrote[0]!, /title = \{Attention is all you need\}/);
});

test("copyPaperAs says so when the paper is gone", async () => {
  const messages: string[] = [];
  await copyPaperAs("reference", { ...paper(), metadata: undefined } as unknown as PaperSummary, {
    getPaper: async () => null,
    copy: async () => assert.fail("nothing to copy"),
    notify: (m) => messages.push(m),
  });
  assert.deepEqual(messages, ["This paper is no longer in your library"]);
});
