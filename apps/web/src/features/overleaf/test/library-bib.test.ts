// The library goes into the linked Overleaf project as one .bib file, so
// Overleaf's own `\cite{` completion offers every paper. Its keys must be the
// ones the export writes, or a report cites keys the .bib does not have.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import type { Paper, ReportSectionTreeNode } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { buildOverleafExportPackage } from "../application/parts";
import { readyCore } from "@/lib/rust-core";

before(async () => {
  await loadTestCore();
});

const libraryBibtex = (papers: readonly Paper[]) => readyCore().libraryBibtex(papers);

const paper = (id: string, title: string, year: number): Paper => ({
  id,
  title,
  authors: ["Ada Lovelace"],
  status: "to_read",
  tags: [],
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  year,
});

const papers = [paper("p1", "A Paper", 1843), paper("p2", "Another Paper", 1843)];
const tree: ReportSectionTreeNode[] = [];

test("the library .bib is the export's references.bib, entry for entry", () => {
  const exported = buildOverleafExportPackage(tree, papers, { bibliographyScope: "all" });
  const bib = exported.files.find((f) => f.path === "references.bib")!.contents;
  assert.equal(libraryBibtex(papers), bib);
});

test("two papers that would share a key get distinct keys", () => {
  const keys = [...libraryBibtex(papers).matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("an empty library is a comment, not an empty file", () => {
  assert.match(libraryBibtex([]), /^%/);
});
