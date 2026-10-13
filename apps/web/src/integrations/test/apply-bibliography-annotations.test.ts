import assert from "node:assert/strict";
import test from "node:test";
import type { BibliographyAnnotation, Paper } from "@weaveforge/core";
import {
  applyBibliographyAnnotations,
  ZOTERO_ATTACHMENT_KEY,
} from "../providers/zotero/bibliography-integration";

function store(papers: Paper[]) {
  const saved: Paper[] = [];
  return {
    saved,
    repo: {
      list: async () => papers,
      save: async (p: Paper) => {
        saved.push(p);
      },
    } as never,
  };
}

const tags = { reconcileSources: async () => {} } as never;
const paper = (metadata: Record<string, unknown>) =>
  ({ id: "p1", title: "T", status: "to_read", metadata }) as unknown as Paper;
const hl: BibliographyAnnotation = { key: "A1", kind: "annotation", text: "x", tags: [] };

test("records the PDF attachment a paper's annotations hang off, even with none yet", async () => {
  // Without it a write-back has nowhere to put a highlight made here.
  const { repo, saved } = store([paper({ zoteroKey: "PAPER" })]);
  await applyBibliographyAnnotations(
    { byPaper: new Map(), attachments: new Map([["PAPER", "ATT"]]) },
    repo,
    tags,
  );
  assert.equal(saved[0]?.metadata?.[ZOTERO_ATTACHMENT_KEY], "ATT");
});

test("a highlight deleted in Zotero leaves the reader too", async () => {
  const { repo, saved } = store([paper({ zoteroKey: "PAPER", zoteroAttachmentKey: "ATT", annotations: [hl] })]);
  await applyBibliographyAnnotations(
    { byPaper: new Map(), attachments: new Map([["PAPER", "ATT"]]) },
    repo,
    tags,
  );
  assert.deepEqual(saved[0]?.metadata?.["annotations"], []);
});

test("a paper the pull did not cover (outside the collection) is left alone", async () => {
  const { repo, saved } = store([paper({ zoteroKey: "ELSEWHERE", annotations: [hl] })]);
  await applyBibliographyAnnotations({ byPaper: new Map(), attachments: new Map() }, repo, tags);
  assert.equal(saved.length, 0);
});

test("pulled annotations are cached on the paper, as before", async () => {
  const { repo, saved } = store([paper({ zoteroKey: "PAPER" })]);
  const n = await applyBibliographyAnnotations(
    { byPaper: new Map([["PAPER", [hl]]]), attachments: new Map([["PAPER", "ATT"]]) },
    repo,
    tags,
  );
  assert.equal(n, 1);
  assert.deepEqual(saved[0]?.metadata?.["annotations"], [hl]);
});
