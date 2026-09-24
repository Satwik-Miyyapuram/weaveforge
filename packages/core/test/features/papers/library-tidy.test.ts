import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateGroups,
  mergePaperInto,
  pickKeeper,
  titleFixFor,
  titleFixes,
  type Paper,
} from "../../../src/features/papers/index.js";

let n = 0;
function paper(over: Partial<Paper> = {}): Paper {
  n++;
  return {
    id: `p${n}`,
    title: `A sufficiently long distinct paper title ${n}`,
    authors: [],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: `2026-01-${String(n % 28 + 1).padStart(2, "0")}T00:00:00Z`,
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

test("a reference-manager filename is proposed as its title", () => {
  const fix = titleFixFor(paper({ id: "a", title: "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf" }));
  assert.deepEqual(fix, {
    id: "a",
    current: "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf",
    proposed: "Accurate, Large Minibatch SGD",
  });
});

test("a placeholder with an identifier is sent to a lookup, one without is listed bare", () => {
  const withDoi = titleFixFor(paper({ id: "a", title: "Catalog Page", doi: "https://doi.org/10.1/X" }));
  assert.deepEqual(withDoi, { id: "a", current: "Catalog Page", lookup: { doi: "10.1/x" } });
  const bare = titleFixFor(paper({ id: "b", title: "SAGE PDF Full Text" }));
  assert.deepEqual(bare, { id: "b", current: "SAGE PDF Full Text" });
});

test("a real title needs no fix, and titleFixes lists only the ones that do", () => {
  const good = paper({ title: "Full Text Search at Scale" });
  assert.equal(titleFixFor(good), null);
  const bad = paper({ title: "Snapshot" });
  assert.deepEqual(titleFixes([good, bad]).map((f) => f.id), [bad.id]);
});

test("duplicates group by DOI, by arXiv id across versions, and transitively by title", () => {
  const a = paper({ id: "a", doi: "10.5/abc" });
  const b = paper({ id: "b", doi: "https://doi.org/10.5/ABC" });
  const c = paper({ id: "c", arxivId: "2101.00001v1" });
  const d = paper({ id: "d", arxivId: "arXiv:2101.00001v3" });
  const e = paper({ id: "e", title: "Attention Is All You Need, Really", doi: "10.5/abc" });
  const f = paper({ id: "f", title: "attention is all you need — really!" });
  const loner = paper({ id: "g" });
  const groups = findDuplicateGroups([a, b, c, d, e, f, loner]);
  assert.equal(groups.length, 2);
  const byDoi = groups.find((g) => g.ids.includes("a"))!;
  assert.deepEqual(byDoi.ids, ["a", "b", "e", "f"]);
  assert.equal(byDoi.reason, "doi");
  const byArxiv = groups.find((g) => g.ids.includes("c"))!;
  assert.deepEqual(byArxiv.ids, ["c", "d"]);
  assert.equal(byArxiv.reason, "arxiv");
});

test("a shared title with two different DOIs is not a duplicate", () => {
  const title = "On the Measure of Intelligence in Machines";
  const groups = findDuplicateGroups([
    paper({ title, doi: "10.1/one" }),
    paper({ title, doi: "10.1/erratum" }),
  ]);
  assert.deepEqual(groups, []);
});

test("placeholder titles never group papers by title", () => {
  assert.deepEqual(findDuplicateGroups([paper({ title: "Catalog Page" }), paper({ title: "Catalog Page" })]), []);
});

test("the keeper is the copy with a PDF, then the one read furthest, then the oldest", () => {
  const old = paper({ id: "old", createdAt: "2020-01-01T00:00:00Z" });
  const read = paper({ id: "read", status: "read", createdAt: "2025-01-01T00:00:00Z" });
  const pdf = paper({ id: "pdf", pdfPath: "x.pdf", createdAt: "2026-01-01T00:00:00Z" });
  assert.equal(pickKeeper([old, read, pdf]).id, "pdf");
  assert.equal(pickKeeper([old, read]).id, "read");
  const twin = { ...old, id: "twin", createdAt: "2021-01-01T00:00:00Z" };
  assert.equal(pickKeeper([twin, old]).id, "old");
});

test("a merge fills gaps and unions, never overwrites, and records where it came from", () => {
  const keep = paper({
    id: "k",
    title: "Catalog Page",
    authors: ["Ada"],
    summary: "Mine.",
    status: "skimmed",
    rating: 3,
    tags: ["ml"],
    metadata: { zoteroKey: "KEEP", note: "kept" },
  });
  const dup = paper({
    id: "d",
    title: "Real Title of the Paper",
    authors: ["Someone Else"],
    doi: "10.1/x",
    pdfPath: "d.pdf",
    summary: "Theirs.",
    status: "read",
    rating: 5,
    tags: ["ML", "vision"],
    metadata: { zoteroKey: "DUP", note: "dup", extra: 1 },
  });
  const merged = mergePaperInto(keep, dup);
  assert.equal(merged.id, "k");
  assert.equal(merged.title, "Real Title of the Paper");
  assert.deepEqual(merged.authors, ["Ada"]);
  assert.equal(merged.doi, "10.1/x");
  assert.equal(merged.pdfPath, "d.pdf");
  assert.equal(merged.summary, "Mine.\n\nTheirs.");
  assert.equal(merged.status, "read");
  assert.equal(merged.rating, 5);
  assert.deepEqual([...merged.tags].sort(), ["ml", "vision"]);
  assert.equal(merged.metadata["zoteroKey"], "KEEP");
  assert.equal(merged.metadata["note"], "kept");
  assert.equal(merged.metadata["extra"], 1);
  assert.deepEqual(merged.metadata["mergedFrom"], ["d"]);
});

test("the same summary twice is kept once, and a second merge appends to mergedFrom", () => {
  const keep = paper({ id: "k", summary: "Same.", metadata: { mergedFrom: ["x"] } });
  const merged = mergePaperInto(keep, paper({ id: "d", summary: " Same. " }));
  assert.equal(merged.summary, "Same.");
  assert.deepEqual(merged.metadata["mergedFrom"], ["x", "d"]);
});

test("list-valued metadata is joined: annotations by key, images by value", () => {
  const keep = paper({ id: "k", metadata: { annotations: [{ key: "A", text: "1" }], images: ["a.png"] } });
  const dup = paper({
    id: "d",
    metadata: { annotations: [{ key: "A", text: "stale" }, { key: "B" }], images: ["a.png", "b.png"] },
  });
  const merged = mergePaperInto(keep, dup);
  assert.deepEqual(merged.metadata["annotations"], [{ key: "A", text: "1" }, { key: "B" }]);
  assert.deepEqual(merged.metadata["images"], ["a.png", "b.png"]);
});

test("Zotero's copy number is dropped only when the unnumbered title is another paper's", () => {
  const title = "Nonparametric Variational Auto-Encoders for Hierarchical Representation Learning";
  const real = paper({ id: "real", title, doi: "10.1109/iccv.2017.545" });
  const first = paper({ id: "first", title: `Goyal et al. - 2017 - ${title}.pdf` });
  const second = paper({ id: "second", title: `Goyal et al. - 2017 - ${title} 1.pdf` });
  const llama = paper({ id: "llama", title: "Touvron et al. - 2023 - Llama 2 Open Foundation and Chat Models 2.pdf" });
  const fixes = new Map(titleFixes([real, first, second, llama]).map((f) => [f.id, f.proposed]));
  assert.equal(fixes.get("second"), title);
  assert.equal(fixes.get("llama"), "Llama 2 Open Foundation and Chat Models 2", "no other paper by that name");

  const groups = findDuplicateGroups([real, first, second, llama]);
  assert.deepEqual(groups.map((g) => g.ids), [["real", "first", "second"]]);
});
