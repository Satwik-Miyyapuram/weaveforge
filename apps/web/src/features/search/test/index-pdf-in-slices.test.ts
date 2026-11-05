import { emptyWorkspaceSnapshot as snapshot } from "@weaveforge/core/testing";
import assert from "node:assert/strict";
import test, { before } from "node:test";
import type { PdfIndexSource, WorkspaceSnapshot } from "@weaveforge/core";
import { WorkspaceSearch } from "@/features/search/application/workspace-search";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

const paper = (id: string, title: string) =>
  ({
    id,
    title,
    authors: [],
    status: "to_read",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  }) as unknown as WorkspaceSnapshot["papers"][number];

function searchFor(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSearch {
  return new WorkspaceSearch({
    snapshot: async () => snapshot(over),
    projectId: () => "p1",
  });
}

const tenPageSource: PdfIndexSource = {
  paperId: "paper-10",
  title: "Ten Page Paper on Neural Attention Models",
  extractedAt: "2026-03-01T00:00:00.000Z",
  pages: [
    {
      pageIndex: 0,
      text: "Introduction to neural network attention mechanisms and sequence transduction models https://arxiv.org/abs/1706.03762 for text.",
    },
    {
      pageIndex: 1,
      text: "Background on recurrent neural networks and why multi-head self-attention improves parallel computation during training.",
    },
    {
      pageIndex: 2,
      text: "Detailed network architecture describing encoder and decoder stacks with positional encodings and residual connections.",
    },
    {
      pageIndex: 3,
      text: "Unique terminology section where platypus appears as an unusual illustrative example word on only this single page.",
    },
    {
      pageIndex: 4,
      text: "Training setup including Adam optimizer parameters, warmup steps, learning rate schedules, and dropout regularization values.",
    },
    {
      pageIndex: 5,
      text: "Experimental results on machine translation benchmarks showing BLEU score improvements on standard evaluation datasets.",
    },
    {
      pageIndex: 6,
      text: "Open source release available at https://github.com/example/weaveforge-model-repo with checkpoints and evaluation scripts.",
    },
    {
      pageIndex: 7,
      text: "Computational complexity comparisons showing lower layer time and maximum path length between distant positions.",
    },
    {
      pageIndex: 8,
      text: "Qualitative attention visualization examples demonstrating how different heads capture syntactic and semantic dependencies.",
    },
    {
      pageIndex: 9,
      text: "Conclusion and future work discussing extensions to speech, image recognition, and multimodal generation tasks.",
    },
  ],
};

test("indexPdfInSlices produces identical corpusSize and search results as indexPdf", async () => {
  const searchA = searchFor({ papers: [paper("paper-10", "Ten Page Paper")] });
  const searchB = searchFor({ papers: [paper("paper-10", "Ten Page Paper")] });

  await searchA.ensure();
  await searchB.ensure();

  let yields = 0;
  searchA.indexPdf(tenPageSource);
  await searchB.indexPdfInSlices(
    tenPageSource,
    () => {
      yields += 1;
      return Promise.resolve();
    },
    3,
  );

  assert.equal(yields, 3, "yields once between each of the 4 slices");
  assert.deepEqual(searchB.corpusSize, searchA.corpusSize);

  const queries = [
    "attention",
    "platypus",
    "arxiv.org",
    "github.com",
    "weaveforge-model-repo",
    "complexity",
    "translation",
  ];

  for (const query of queries) {
    const hitsA = searchA.search(query);
    const hitsB = searchB.search(query);
    assert.ok(hitsA.length > 0, `query '${query}' should match documents`);
    assert.deepEqual(
      hitsB.map((h) => h.id),
      hitsA.map((h) => h.id),
      `results for query '${query}' must match identically in ids and order`,
    );
  }
});

test("indexPdfInSlices stops quietly when index is invalidated during yield", async () => {
  const search = searchFor({ papers: [paper("paper-10", "Ten Page Paper")] });
  await search.ensure();

  await search.indexPdfInSlices(
    tenPageSource,
    () => {
      search.invalidate();
      return Promise.resolve();
    },
    3,
  );

  assert.equal(search.ready, false);
});
