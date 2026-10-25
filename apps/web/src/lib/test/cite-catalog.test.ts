import { test } from "node:test";
import assert from "node:assert/strict";
import { citeCatalogFrom } from "@/lib/hooks/use-cite-links";

const paper = (id: string, title: string) => ({ id, title, authors: ["Ada Lovelace"], year: 1843 });

test("papers, then notes, then sections; first title wins across kinds (11-15)", () => {
  const catalog = citeCatalogFrom(
    [paper("p1", "Attention"), paper("p2", "attention "), paper("p3", "")],
    [{ id: "n1", title: "ATTENTION" }, { id: "n2", title: "Methods" }, { id: "n3", title: "  " }],
    [{ id: "s1", title: "methods" }, { id: "s2", title: "Results" }],
  );
  assert.deepEqual(catalog.titles, ["Attention", "Methods", "Results"]);
  assert.deepEqual(
    catalog.completions.map((c) => [c.title, c.detail]),
    [
      ["Attention", catalog.completions[0]?.detail],
      ["Methods", "note"],
      ["Results", "section"],
    ],
  );
  // Every row is still listed for resolution, duplicates included.
  assert.equal(catalog.papers.length, 3);
  assert.equal(catalog.notes.length, 3);
  assert.equal(catalog.sections.length, 2);
});

test("an empty library is an empty catalog", () => {
  assert.deepEqual(citeCatalogFrom([], [], []), {
    titles: [],
    completions: [],
    notes: [],
    papers: [],
    sections: [],
  });
});
