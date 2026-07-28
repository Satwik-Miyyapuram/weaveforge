import type { Paper, ReportSectionTreeNode } from "@thesis/core";
import { markdownToLatex, normalizeTitleKey } from "@thesis/core";

export interface OverleafExportOptions {
  /** Document title for `\title{}`. */
  title?: string;
  includeBibliography?: boolean;
  includeSectionNotes?: boolean;
}

export interface OverleafExportFile {
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

const SECTION_CMD = ["chapter", "section", "subsection", "subsubsection"] as const;

export type CitationFormat = "latex" | "pandoc" | "footnote" | "raw";

/**
 * Resolve a paper's preferred cite key without uniqueness suffixing.
 * Precedence: metadata.citeKey / citationKey → BibTeX entry key → Better
 * BibTeX `Citation Key:` in extra → DOI → arXiv → synthetic paper id.
 */
export function resolveCiteKey(paper: Paper): string {
  const fromMeta =
    (typeof paper.metadata?.["citeKey"] === "string" && paper.metadata["citeKey"].trim()) ||
    (typeof paper.metadata?.["citationKey"] === "string" && paper.metadata["citationKey"].trim()) ||
    "";
  const fromBib = paper.bibtex?.match(/@\w+\{([^,\s]+)\s*,/)?.[1]?.trim() || "";
  const fromExtra =
    typeof paper.metadata?.["extra"] === "string"
      ? /Citation Key:\s*(\S+)/i.exec(paper.metadata["extra"] as string)?.[1]?.trim() || ""
      : "";
  const preferred = (fromMeta || fromBib || fromExtra).replace(/[^A-Za-z0-9_:-]/g, "_");
  return (
    preferred ||
    (paper.doi && `doi_${paper.doi.replace(/[^A-Za-z0-9]/g, "_")}`) ||
    (paper.arxivId && `arxiv_${paper.arxivId.replace(/[^A-Za-z0-9]/g, "_")}`) ||
    `paper_${paper.id.replace(/-/g, "").slice(0, 12)}`
  );
}

/** Deduping wrapper around {@link resolveCiteKey} for bibliography export. */
export function bibKey(paper: Paper, used: Set<string>): string {
  const base = resolveCiteKey(paper);
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

/**
 * Format a cite key for insertion. Empty/whitespace keys yield "" — callers
 * decide how to surface "no resolvable key" rather than inventing one here.
 */
export function formatCitation(key: string, format: CitationFormat): string {
  const trimmed = key.trim().replace(/[^A-Za-z0-9_:-]/g, "_");
  if (!trimmed) return "";
  switch (format) {
    case "latex":
      return `\\cite{${trimmed}}`;
    case "pandoc":
      return `[@${trimmed}]`;
    case "footnote":
      return `[^${trimmed}]`;
    case "raw":
      return trimmed;
  }
}

/** Resolve then format in one step for a paper. */
export function formatPaperCitation(paper: Paper, format: CitationFormat): string {
  return formatCitation(resolveCiteKey(paper), format);
}

/** Build title→cite-key map used by markdown→LaTeX wikilink conversion. */
export function buildCiteByTitle(
  papers: readonly Paper[],
): { citeByTitle: Map<string, string>; keyByPaperId: Map<string, string> } {
  const used = new Set<string>();
  const citeByTitle = new Map<string, string>();
  const keyByPaperId = new Map<string, string>();
  for (const p of papers) {
    const key = bibKey(p, used);
    keyByPaperId.set(p.id, key);
    const titleKey = normalizeTitleKey(p.title);
    if (titleKey && !citeByTitle.has(titleKey)) citeByTitle.set(titleKey, key);
  }
  return { citeByTitle, keyByPaperId };
}

/**
 * Escape a value for a braced BibTeX field.
 *
 * Unescaped `&`, `%`, `#`, `_` and `$` are the usual cause of an Overleaf build
 * failing on a bibliography rather than on the document — a paper titled
 * "Cost & Benefit" or "100% Recall" is enough to break the run.
 *
 * Braces are deliberately left alone when balanced: Zotero and Better BibTeX
 * emit `{BERT}` to protect capitalisation, and escaping that would corrupt the
 * rendered entry. Unbalanced braces cannot be parsed by biber, so those are
 * escaped instead.
 */
export function escapeBibField(value: string): string {
  let depth = 0;
  let balanced = true;
  for (const ch of value) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) {
      balanced = false;
      break;
    }
  }
  if (depth !== 0) balanced = false;

  let out = "";
  for (const ch of value) {
    switch (ch) {
      case "\\":
        out += "\\textbackslash{}";
        break;
      case "~":
        out += "\\textasciitilde{}";
        break;
      case "^":
        out += "\\textasciicircum{}";
        break;
      case "&":
      case "%":
      case "#":
      case "_":
      case "$":
        out += `\\${ch}`;
        break;
      case "{":
      case "}":
        out += balanced ? ch : `\\${ch}`;
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Venues that mean a proceedings entry rather than a journal one. */
const PROCEEDINGS_RE =
  /\b(proceedings|conference|conf\.?|workshop|symposium|congress|meeting)\b|\b(neurips|nips|icml|iclr|cvpr|iccv|eccv|aaai|ijcai|acl|emnlp|naacl|coling|sigir|kdd|www|chi|uist|siggraph|interspeech|icassp|miccai)\b/i;

/**
 * Choose the entry type. Getting this wrong is the other common source of
 * Overleaf warnings: an `@article` with no `journal` makes biber complain about
 * a missing journaltitle, and conference papers filed as `@article` lose their
 * venue entirely because biblatex ignores `booktitle` on an article.
 */
function bibEntryShape(paper: Paper): { type: string; venueField: string | null } {
  const venue = paper.venue?.trim();
  if (venue && PROCEEDINGS_RE.test(venue)) return { type: "inproceedings", venueField: "booktitle" };
  if (venue) return { type: "article", venueField: "journal" };
  // No venue: a preprint or something unpublished. `@misc` is the honest type
  // and, unlike `@article`, does not warn about the missing journal.
  return { type: "misc", venueField: null };
}

function paperToBibtex(paper: Paper, key: string): string {
  if (paper.bibtex?.trim()) {
    // Ensure the entry uses our stable key when possible.
    return paper.bibtex.replace(/@(\w+)\{[^,]+,/, `@$1{${key},`);
  }
  const authors = paper.authors.length ? paper.authors.join(" and ") : "Unknown";
  const { type, venueField } = bibEntryShape(paper);
  const venue = paper.venue?.trim();
  const arxivId = paper.arxivId?.trim().replace(/^arxiv:/i, "");
  // `url` and `doi` are verbatim fields in biblatex — escaping them would break
  // the link. They are trimmed and otherwise passed through untouched.
  const url = paper.url?.trim() || (arxivId ? `https://arxiv.org/abs/${arxivId}` : "");

  const fields = [
    `  title = {${escapeBibField(paper.title)}}`,
    `  author = {${escapeBibField(authors)}}`,
    paper.year != null ? `  year = {${paper.year}}` : null,
    venue && venueField ? `  ${venueField} = {${escapeBibField(venue)}}` : null,
    paper.doi?.trim() ? `  doi = {${paper.doi.trim()}}` : null,
    url ? `  url = {${url}}` : null,
    // biblatex renders arXiv identifiers properly only with all three.
    arxivId ? `  eprint = {${arxivId}}` : null,
    arxivId ? "  eprinttype = {arxiv}" : null,
    arxivId ? "  archivePrefix = {arXiv}" : null,
    type === "misc" && !venue ? "  howpublished = {Preprint}" : null,
  ].filter(Boolean);
  return `@${type}{${key},\n${fields.join(",\n")}\n}`;
}

function uniqueFigureName(raw: string, used: Set<string>): string {
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, "_") || "figure.bin";
  let name = safe;
  let n = 2;
  while (used.has(name)) {
    const dot = safe.lastIndexOf(".");
    name = dot > 0 ? `${safe.slice(0, dot)}_${n}${safe.slice(dot)}` : `${safe}_${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}

function walkSections(
  nodes: readonly ReportSectionTreeNode[],
  depth: number,
  includeNotes: boolean,
  citeByTitle: ReadonlyMap<string, string> | undefined,
  out: string[],
  warnings: string[],
  images: OverleafExportImage[],
  usedFigureNames: Set<string>,
  stats: { sections: number; equationsApprox: number; figures: number },
): void {
  for (const node of nodes) {
    const s = node.section;
    stats.sections += 1;
    const cmd = SECTION_CMD[Math.min(depth, SECTION_CMD.length - 1)]!;
    const label = s.sectionNo ? `${s.sectionNo} ${s.title}` : s.title;
    out.push(`\\${cmd}{${escapeTitle(label)}}`);
    out.push(`% status: ${s.status}; words: ${s.wordCount}${s.targetWords != null ? ` / ${s.targetWords}` : ""}`);

    if (includeNotes && s.notes?.trim()) {
      const converted = markdownToLatex(s.notes, citeByTitle ? { citeByTitle } : undefined);
      warnings.push(...converted.warnings.map((w) => `Section "${s.title}": ${w}`));
      stats.equationsApprox += (s.notes.match(/\$/g) ?? []).length;
      let latex = converted.latex;
      for (const img of converted.images) {
        const fileName = uniqueFigureName(img.fileName, usedFigureNames);
        if (fileName !== img.fileName) {
          latex = latex.replaceAll(`figures/${img.fileName}`, `figures/${fileName}`);
        }
        images.push({ storagePath: img.path, zipPath: `figures/${fileName}` });
        stats.figures += 1;
      }
      if (latex) out.push(latex);
    } else if (!s.notes?.trim()) {
      out.push("% (no section notes)");
    }
    out.push("");
    walkSections(
      node.children,
      depth + 1,
      includeNotes,
      citeByTitle,
      out,
      warnings,
      images,
      usedFigureNames,
      stats,
    );
  }
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

  const body: string[] = [];
  walkSections(
    tree,
    0,
    includeNotes,
    includeBib && papers.length > 0 ? citeByTitle : undefined,
    body,
    warnings,
    images,
    new Set(),
    stats,
  );

  const title = opts.title?.trim() || "WeaveForge report export";
  const mainTex = [
    "% Generated by WeaveForge — Overleaf export package.",
    "% This plaintext left the WeaveForge RLS boundary by explicit user action.",
    "\\documentclass[11pt,a4paper]{report}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{hyperref}",
    "\\usepackage{graphicx}",
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
    includeBib && papers.length ? "\\printbibliography" : "% no bibliography entries",
    "\\end{document}",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const files: OverleafExportFile[] = [{ path: "main.tex", contents: mainTex }];

  if (includeBib && papers.length > 0) {
    const entries = papers.map((p) => {
      const key = keyByPaperId.get(p.id)!;
      stats.bibliographyEntries += 1;
      return paperToBibtex(p, key);
    });
    files.push({ path: "references.bib", contents: entries.join("\n\n") + "\n" });
  } else if (includeBib) {
    warnings.push("Bibliography requested but no papers were available.");
    files.push({ path: "references.bib", contents: "% (empty)\n" });
  }

  const exportedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    exportedAt,
    app: "WeaveForge",
    kind: "overleaf-export-package",
    title,
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
      "  references.bib   — bibliography from your paper library (if included)",
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
