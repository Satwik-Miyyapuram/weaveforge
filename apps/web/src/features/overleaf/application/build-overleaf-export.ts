import type { Experiment, Paper, ReportSectionTreeNode } from "@weaveforge/core";
import { resolveResultsTables } from "@/features/report/application/results-table-refs";
import { PRISMA_FIGURE_PACKAGES } from "@weaveforge/core";
import type { CitationFormat } from "@weaveforge/core";
import { paperCiteKeys } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

export interface OverleafExportOptions {
  /** Document title for `\title{}`. */
  title?: string;
  includeBibliography?: boolean;
  includeSectionNotes?: boolean;
  /**
   * Which papers reach `references.bib`.
   *
   * `"all"` (default) exports the whole library and adds `\nocite{*}` so every
   * entry actually prints. Without the `\nocite`, biblatex's numeric style
   * renders only cited entries, so a 20-paper export would show two — the
   * `.bib` is right and the PDF looks broken.
   *
   * `"cited"` exports only papers cited in the report, which is what a
   * finished thesis bibliography should contain.
   */
  bibliographyScope?: "cited" | "all";
  /** Runs for `exptable:` results tables in section notes; without them a table ref is a warning. */
  experiments?: readonly Experiment[];
}

/** The tree with every `exptable:` ref in its notes turned into a LaTeX table. */
function withResultsTables(
  nodes: readonly ReportSectionTreeNode[],
  experiments: readonly Experiment[],
): ReportSectionTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    section: node.section.notes
      ? { ...node.section, notes: resolveResultsTables(node.section.notes, experiments, "latex") }
      : node.section,
    children: withResultsTables(node.children, experiments),
  }));
}

interface OverleafExportFile {
  path: string;
  contents: string;
}

/** Binary figure to fetch from report-images and place under `figures/`. */
export interface OverleafExportImage {
  /** Storage path after `reportimg:` (ownerId/sectionId/file). */
  storagePath: string;
  /** Relative ZIP path, e.g. `figures/uuid.webp`. */
  zipPath: string;
}

export interface OverleafExportResult {
  files: OverleafExportFile[];
  images: OverleafExportImage[];
  warnings: string[];
  stats: {
    sections: number;
    equationsApprox: number;
    bibliographyEntries: number;
    figures: number;
  };
}

/**
 * Cite keys live in core now, because the bibliography check needs the same
 * answers this export writes. Re-exported here so callers that already import
 * them from the export keep working.
 */
export function collectCitedKeys(latex: string): Set<string> {
  return readyCore().collectCitedKeys(latex);
}
export type { CitationFormat };

/**
 * The export's files with `manifest.json` rewritten for figures whose blobs
 * could not be loaded: they leave `files`, are listed under `missingFigures`
 * and get a warning each. With none missing, `files` is returned as is.
 */
export function withMissingFigures(
  files: readonly OverleafExportFile[],
  missing: readonly OverleafExportImage[],
): readonly OverleafExportFile[] {
  if (missing.length === 0) return files;
  return readyCore().withMissingFigures(files, missing);
}

/** Title→cite-key and paper-id→cite-key maps for the export's wikilinks and .bib keys. */
function buildCiteByTitle(
  papers: readonly Paper[],
): { citeByTitle: Map<string, string>; keyByPaperId: Map<string, string> } {
  const keys = paperCiteKeys(papers);
  const citeByTitle = new Map<string, string>();
  const keyByPaperId = new Map<string, string>();
  papers.forEach((p, i) => {
    const key = keys[i] ?? "";
    keyByPaperId.set(p.id, key);
    const titleKey = readyCore().normalizeTitleKey(p.title ?? "");
    if (titleKey && !citeByTitle.has(titleKey)) citeByTitle.set(titleKey, key);
  });
  return { citeByTitle, keyByPaperId };
}

function escapeTitle(s: string): string {
  return s.replace(/([{}$&#^_%\\])/g, "\\$1");
}

/**
 * Build an Overleaf-ready plaintext package from the WeaveForge report outline
 * and optional paper bibliography. Pure — no I/O, no network.
 * Binary figures are listed in `images` for the download step to fetch.
 * Section-note `[[Paper Title]]` wikilinks become `\cite{…}` when bibliography is included.
 */
export function buildOverleafExportPackage(
  tree: readonly ReportSectionTreeNode[],
  papers: readonly Paper[],
  opts: OverleafExportOptions = {},
): OverleafExportResult {
  const includeNotes = opts.includeSectionNotes !== false;
  const includeBib = opts.includeBibliography !== false;
  const warnings: string[] = [];
  const images: OverleafExportImage[] = [];
  const stats = { sections: 0, equationsApprox: 0, bibliographyEntries: 0, figures: 0 };

  const { citeByTitle, keyByPaperId } = includeBib
    ? buildCiteByTitle(papers)
    : { citeByTitle: new Map<string, string>(), keyByPaperId: new Map<string, string>() };

  const walk = readyCore().walkOverleafSections(
    opts.experiments ? withResultsTables(tree, opts.experiments) : tree,
    {
      includeNotes,
      citeByTitle: includeBib && papers.length > 0 ? citeByTitle : undefined,
    },
  );
  const body: string[] = walk.out;
  warnings.push(...walk.warnings);
  images.push(...walk.images);
  stats.sections = walk.stats.sections;
  stats.equationsApprox = walk.stats.equationsApprox;
  stats.figures = walk.stats.figures;

  // Decide the bibliography set before the preamble, because `\nocite{*}` and
  // `\printbibliography` must agree with what actually lands in references.bib.
  const scope = opts.bibliographyScope ?? "all";
  const citedKeys = collectCitedKeys(body.join("\n"));
  const bibPapers =
    includeBib && papers.length > 0
      ? scope === "cited"
        ? papers.filter((p) => citedKeys.has(keyByPaperId.get(p.id) ?? ""))
        : [...papers]
      : [];
  if (includeBib && scope === "cited" && papers.length > 0 && bibPapers.length === 0) {
    warnings.push(
      "Bibliography set to cited-only, but the report cites no papers — references.bib is empty.",
    );
  }

  // A PRISMA figure carries TikZ into the body. Loading the packages only when
  // something uses them keeps the preamble of an ordinary report unchanged.
  const usesTikz = body.some((chunk) => chunk.includes("\\begin{tikzpicture}"));

  const title = opts.title?.trim() || "WeaveForge report export";
  const mainTex = [
    "% Generated by WeaveForge — Overleaf export package.",
    "% This plaintext left the WeaveForge RLS boundary by explicit user action.",
    "\\documentclass[11pt,a4paper]{report}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{hyperref}",
    "\\usepackage{graphicx}",
    ...(usesTikz ? PRISMA_FIGURE_PACKAGES.map((pkg) => `\\usepackage{${pkg}}`) : []),
    includeBib ? "\\usepackage[backend=biber,style=numeric]{biblatex}" : "% no bibliography",
    includeBib ? "\\addbibresource{references.bib}" : "",
    `\\title{${escapeTitle(title)}}`,
    "\\author{}",
    "\\date{\\today}",
    "\\begin{document}",
    "\\maketitle",
    "\\tableofcontents",
    "\\clearpage",
    ...body,
    // Numeric style prints only cited entries, so an "all" export needs this or
    // the PDF silently omits most of references.bib.
    scope === "all" && bibPapers.length ? "\\nocite{*}" : "",
    bibPapers.length ? "\\printbibliography" : "% no bibliography entries",
    "\\end{document}",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const files: OverleafExportFile[] = [{ path: "main.tex", contents: mainTex }];

  if (bibPapers.length > 0) {
    const entries = bibPapers.map((p) => {
      const key = keyByPaperId.get(p.id)!;
      stats.bibliographyEntries += 1;
      return readyCore().paperToBibtex(p, key);
    });
    files.push({ path: "references.bib", contents: readyCore().joinBibtex(entries) });
  } else if (includeBib) {
    if (papers.length === 0) {
      warnings.push("Bibliography requested but no papers were available.");
    }
    files.push({ path: "references.bib", contents: readyCore().joinBibtex([]) });
  }

  const exportedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    exportedAt,
    app: "WeaveForge",
    kind: "overleaf-export-package",
    title,
    bibliographyScope: includeBib ? scope : null,
    files: [...files.map((f) => f.path), ...images.map((i) => i.zipPath)],
    stats,
    warnings,
    note: "Upload these files to a new or existing Overleaf project. WeaveForge does not push to Overleaf.",
  };
  files.push({ path: "manifest.json", contents: JSON.stringify(manifest, null, 2) + "\n" });
  files.push({
    path: "README.txt",
    contents: [
      "WeaveForge → Overleaf export package",
      `Exported at: ${exportedAt}`,
      "",
      "Contents:",
      "  main.tex         — report outline (+ section notes as LaTeX)",
      includeBib
        ? scope === "cited"
          ? "  references.bib   — only the papers cited in this report"
          : "  references.bib   — your whole paper library; main.tex uses \\nocite{*} so every entry prints"
        : "  references.bib   — not included",
      "  figures/         — images from section notes (if any)",
      "  manifest.json    — export metadata and warnings",
      "",
      "How to use:",
      "  1. Create a new Overleaf project (or open an existing one).",
      "  2. Upload main.tex, references.bib, and the figures/ folder.",
      "  3. Compile in Overleaf. Fix any warnings listed in manifest.json.",
      "",
      "Citations: [[Paper Title]] wikilinks in section notes become \\cite{…} when",
      "the title matches a paper in your library (case-insensitive).",
      "",
      "Privacy: this ZIP contains plaintext. It left WeaveForge by your explicit export.",
      "WeaveForge never stores this package or your Overleaf Git token in the browser export path.",
      "",
    ].join("\n"),
  });

  if (stats.sections === 0) warnings.push("Report has no sections — main.tex is an empty shell.");

  return { files, images, warnings, stats };
}
