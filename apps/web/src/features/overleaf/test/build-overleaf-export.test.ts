import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOverleafExportPackage,
  collectCitedKeys,
  formatCitation,
  formatPaperCitation,
  resolveCiteKey,
} from "../application/build-overleaf-export";
import type { Paper, ReportSectionTreeNode } from "@weaveforge/core";

const tree: ReportSectionTreeNode[] = [
  {
    section: {
      id: "1",
      title: "Introduction",
      status: "drafting",
      wordCount: 10,
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      notes: "Hello **world** and $x=1$.",
    },
    children: [],
  },
];

const papers: Paper[] = [
  {
    id: "p1",
    title: "A Paper",
    authors: ["Ada Lovelace"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    year: 1843,
  },
];

test("buildOverleafExportPackage emits main.tex, bib, manifest", () => {
  const result = buildOverleafExportPackage(tree, papers, { title: "Demo" });
  const paths = result.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["README.txt", "main.tex", "manifest.json", "references.bib"]);
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  assert.match(main, /\\chapter\{Introduction\}/);
  assert.match(main, /\\textbf\{world\}/);
  assert.match(main, /\$x=1\$/);
  assert.equal(result.stats.sections, 1);
  assert.equal(result.stats.bibliographyEntries, 1);
  assert.equal(result.images.length, 0);
});

test("buildOverleafExportPackage collects reportimg figures", () => {
  const withFig: ReportSectionTreeNode[] = [
    {
      section: {
        ...tree[0]!.section,
        notes: "Plot:\n\n![My fig](reportimg:uid/sid/plot.webp)\n",
      },
      children: [],
    },
  ];
  const result = buildOverleafExportPackage(withFig, [], {
    includeBibliography: false,
    title: "Figs",
  });
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  assert.match(main, /\\includegraphics\[width=\\linewidth\]\{figures\/plot\.webp\}/);
  assert.deepEqual(result.images, [
    { storagePath: "uid/sid/plot.webp", zipPath: "figures/plot.webp" },
  ]);
  assert.equal(result.stats.figures, 1);
});

test("buildOverleafExportPackage omits notes and bib when disabled", () => {
  const result = buildOverleafExportPackage(tree, [], {
    includeSectionNotes: false,
    includeBibliography: false,
  });
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  assert.doesNotMatch(main, /\\textbf/);
  assert.ok(!result.files.some((f) => f.path === "references.bib"));
});

test("buildOverleafExportPackage turns [[Paper]] wikilinks into \\cite", () => {
  const withCite: ReportSectionTreeNode[] = [
    {
      section: {
        ...tree[0]!.section,
        notes: "Following [[A Paper]] we proceed.",
      },
      children: [],
    },
  ];
  const result = buildOverleafExportPackage(withCite, papers, { title: "Cite demo" });
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  const bib = result.files.find((f) => f.path === "references.bib")!.contents;
  assert.match(main, /Following \\cite\{paper_p1\} we proceed\./);
  // @misc, not @article: the fixture paper has no venue, and an @article
  // without a journal makes biber warn about a missing journaltitle.
  assert.match(bib, /@misc\{paper_p1,/);
  assert.equal(result.warnings.length, 0);
});

test("buildOverleafExportPackage prefers metadata.citeKey for \\cite keys", () => {
  const withKey: Paper[] = [
    {
      ...papers[0]!,
      metadata: { citeKey: "vaswani2017attention" },
    },
  ];
  const withCite: ReportSectionTreeNode[] = [
    {
      section: {
        ...tree[0]!.section,
        notes: "See [[A Paper]].",
      },
      children: [],
    },
  ];
  const result = buildOverleafExportPackage(withCite, withKey, { title: "Keys" });
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  const bib = result.files.find((f) => f.path === "references.bib")!.contents;
  assert.match(main, /\\cite\{vaswani2017attention\}/);
  assert.match(bib, /@misc\{vaswani2017attention,/);
});

test("formatCitation emits latex, pandoc, footnote, and raw forms", () => {
  assert.equal(formatCitation("smith2020", "latex"), "\\cite{smith2020}");
  assert.equal(formatCitation("smith2020", "pandoc"), "[@smith2020]");
  assert.equal(formatCitation("smith2020", "footnote"), "[^smith2020]");
  assert.equal(formatCitation("smith2020", "raw"), "smith2020");
});

test("formatCitation returns empty string when the key is blank", () => {
  assert.equal(formatCitation("", "latex"), "");
  assert.equal(formatCitation("   ", "pandoc"), "");
});

test("formatCitation sanitises unsafe characters in raw keys", () => {
  assert.equal(formatCitation("smith 2020}", "latex"), "\\cite{smith_2020_}");
  assert.equal(formatCitation("a/b", "pandoc"), "[@a_b]");
});

test("resolveCiteKey follows metadata → bibtex → extra → doi → arxiv → id", () => {
  assert.equal(
    resolveCiteKey({ ...papers[0]!, metadata: { citeKey: "from_meta" } }),
    "from_meta",
  );
  assert.equal(
    resolveCiteKey({
      ...papers[0]!,
      bibtex: "@article{from_bib,\n  title={X}\n}",
      metadata: {},
    }),
    "from_bib",
  );
  assert.equal(
    resolveCiteKey({
      ...papers[0]!,
      metadata: { extra: "Citation Key: from_extra" },
    }),
    "from_extra",
  );
  assert.equal(
    resolveCiteKey({ ...papers[0]!, doi: "10.1000/xyz", metadata: {} }),
    "doi_10_1000_xyz",
  );
  assert.equal(
    resolveCiteKey({ ...papers[0]!, arxivId: "2401.00001", metadata: {} }),
    "arxiv_2401_00001",
  );
  assert.equal(resolveCiteKey({ ...papers[0]!, metadata: {} }), "paper_p1");
});

test("formatPaperCitation uses the shared resolveCiteKey precedence", () => {
  const keyed = { ...papers[0]!, metadata: { citeKey: "attn" } };
  assert.equal(formatPaperCitation(keyed, "latex"), "\\cite{attn}");
  assert.equal(formatPaperCitation(keyed, "pandoc"), "[@attn]");
  assert.equal(formatPaperCitation(keyed, "footnote"), "[^attn]");
  assert.equal(formatPaperCitation(keyed, "raw"), "attn");
});

/** Bibliography entry for a single paper, as written to references.bib. */
function bibFor(overrides: Partial<Paper>): string {
  const result = buildOverleafExportPackage(tree, [{ ...papers[0]!, ...overrides }], {
    includeBibliography: true,
  });
  return result.files.find((f) => f.path === "references.bib")!.contents;
}

test("bibtex escapes LaTeX specials that would break the Overleaf build", () => {
  const bib = bibFor({
    title: "Cost & Benefit: 100% Recall in C_4 #networks",
    authors: ["Smith & Jones"],
    venue: "Journal of 50% Things",
  });
  // Plain string comparison: these assertions are about backslashes, and a
  // regex literal would need every one doubled again for no benefit.
  assert.ok(
    bib.includes("title = {Cost \\& Benefit: 100\\% Recall in C\\_4 \\#networks}"),
    bib,
  );
  assert.ok(bib.includes("author = {Smith \\& Jones}"), bib);
  assert.ok(bib.includes("journal = {Journal of 50\\% Things}"), bib);
  // No bare special survives in a field *value*. Cite keys and entry types are
  // excluded — `paper_p1` legitimately contains an underscore.
  for (const line of bib.split("\n")) {
    const value = /^\s+\w+ = \{(.*)\}[,]?$/.exec(line)?.[1];
    if (value == null) continue;
    for (const [index, ch] of [...value].entries()) {
      if ("&%#_$".includes(ch)) {
        assert.equal(value[index - 1], "\\", `unescaped ${ch} in field value: ${line}`);
      }
    }
  }
});

test("bibtex keeps balanced braces so Better BibTeX case protection survives", () => {
  const bib = bibFor({ title: "{BERT}: Pre-training of Deep {Transformers}" });
  assert.match(bib, /title = \{\{BERT\}: Pre-training of Deep \{Transformers\}\}/);
});

test("bibtex escapes unbalanced braces, which biber cannot parse", () => {
  const bib = bibFor({ title: "Broken {brace" });
  assert.match(bib, /title = \{Broken \\{brace\}/);
});

test("bibtex picks the entry type from the venue", () => {
  assert.match(bibFor({ venue: "Journal of Machine Learning Research" }), /^@article\{/m);
  assert.match(
    bibFor({ venue: "Proceedings of the 40th International Conference on Machine Learning" }),
    /^@inproceedings\{/m,
  );
  assert.match(bibFor({ venue: "NeurIPS" }), /^@inproceedings\{/m);
  // A conference paper must carry booktitle, not journal — biblatex ignores
  // booktitle on an @article, which silently drops the venue.
  assert.match(bibFor({ venue: "CVPR" }), /booktitle = \{CVPR\}/);
});

test("bibtex uses @misc for a venueless preprint rather than a journal-less @article", () => {
  const bib = bibFor({ venue: undefined, arxivId: "1706.03762" });
  assert.match(bib, /^@misc\{/m);
  assert.doesNotMatch(bib, /journal =/);
});

test("bibtex emits the arXiv identifier and a derived url", () => {
  const bib = bibFor({ arxivId: "arXiv:1706.03762", url: undefined });
  assert.match(bib, /eprint = \{1706\.03762\}/);
  assert.match(bib, /eprinttype = \{arxiv\}/);
  assert.match(bib, /archivePrefix = \{arXiv\}/);
  assert.match(bib, /url = \{https:\/\/arxiv\.org\/abs\/1706\.03762\}/);
});

test("bibtex leaves url and doi verbatim so links are not corrupted", () => {
  const bib = bibFor({
    doi: "10.1145/3292500.3330701",
    url: "https://example.org/a_b?x=1&y=2%20z",
  });
  assert.match(bib, /doi = \{10\.1145\/3292500\.3330701\}/);
  assert.match(bib, /url = \{https:\/\/example\.org\/a_b\?x=1&y=2%20z\}/);
});

test("bibtex passthrough rewrites the key on a stored Zotero entry", () => {
  const bib = bibFor({ bibtex: "@inproceedings{their_key,\n  title={X}\n}", metadata: {} });
  assert.match(bib, /@inproceedings\{their_key,/);
});

const citingTree: ReportSectionTreeNode[] = [
  {
    section: {
      id: "1",
      title: "Introduction",
      status: "drafting",
      wordCount: 10,
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      notes: "As shown in [[A Paper]] this holds.",
    },
    children: [],
  },
];

const twoPapers: Paper[] = [
  papers[0]!,
  { ...papers[0]!, id: "p2", title: "Uncited Paper", metadata: { citeKey: "uncited2020" } },
];

test("bibliographyScope 'all' exports every paper and adds nocite", () => {
  const result = buildOverleafExportPackage(citingTree, twoPapers, {
    includeBibliography: true,
    bibliographyScope: "all",
  });
  const bib = result.files.find((f) => f.path === "references.bib")!.contents;
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  assert.match(bib, /Uncited Paper/);
  assert.equal(result.stats.bibliographyEntries, 2);
  // Without nocite, biblatex numeric would print only the cited entry.
  assert.ok(main.includes("\\nocite{*}"), main);
  assert.match(main, /\printbibliography/);
});

test("bibliographyScope 'cited' drops uncited papers and omits nocite", () => {
  const result = buildOverleafExportPackage(citingTree, twoPapers, {
    includeBibliography: true,
    bibliographyScope: "cited",
  });
  const bib = result.files.find((f) => f.path === "references.bib")!.contents;
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  assert.match(bib, /A Paper/);
  assert.doesNotMatch(bib, /Uncited Paper/);
  assert.equal(result.stats.bibliographyEntries, 1);
  assert.ok(!main.includes("\\nocite"), main);
});

test("bibliographyScope 'cited' warns when the report cites nothing", () => {
  const result = buildOverleafExportPackage(tree, twoPapers, {
    includeBibliography: true,
    bibliographyScope: "cited",
  });
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  assert.equal(result.stats.bibliographyEntries, 0);
  assert.ok(result.warnings.some((w) => w.includes("cites no papers")), result.warnings.join("; "));
  // No entries means no printbibliography — an empty one is a biber warning.
  assert.doesNotMatch(main, /\printbibliography/);
});

test("collectCitedKeys reads comma-separated cite lists", () => {
  assert.deepEqual(
    [...collectCitedKeys("text \\cite{a, b} more \\cite{c}")].sort(),
    ["a", "b", "c"],
  );
});
