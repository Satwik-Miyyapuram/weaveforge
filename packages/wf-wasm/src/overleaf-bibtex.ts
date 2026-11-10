/**
 * The Overleaf BibTeX export helpers (Rust `overleaf::bibtex`), re-exported from index.ts.
 * The paper input is the subset of `Paper` the entries read; a `Paper` satisfies it. The cite-key
 * fields are flattened from `metadata` here, as the Rust side expects them at the top level.
 */
import {
  paperCiteKeys as rawPaperCiteKeys,
  collectCitedKeys as rawCollectCitedKeys,
  paperToBibtex as rawPaperToBibtex,
  joinBibtex as rawJoinBibtex,
  libraryBibtex as rawLibraryBibtex,
} from "../pkg/wf_wasm.js";

/** The paper fields a `.bib` entry reads, as a `Paper` supplies them. */
export interface BibPaperInput {
  id: string;
  title: string;
  authors?: readonly string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  bibtex?: string;
  metadata?: Record<string, unknown>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toBibPaper(paper: BibPaperInput) {
  const meta = paper.metadata ?? {};
  return {
    id: paper.id,
    title: paper.title,
    authors: [...(paper.authors ?? [])],
    year: typeof paper.year === "number" ? paper.year : undefined,
    venue: paper.venue,
    doi: paper.doi,
    arxivId: paper.arxivId,
    url: paper.url,
    bibtex: paper.bibtex,
    citeKey: stringField(meta["citeKey"]),
    citationKey: stringField(meta["citationKey"]),
    extra: stringField(meta["extra"]),
  };
}

/** One cite key per paper, in order and unique across the list. */
export function paperCiteKeys(papers: readonly BibPaperInput[]): string[] {
  return rawPaperCiteKeys(papers.map(toBibPaper));
}

/** The cite keys a LaTeX body cites, from its `\cite{...}` commands. */
export function collectCitedKeys(latex: string): Set<string> {
  return new Set<string>(rawCollectCitedKeys(latex));
}

/** One `.bib` entry under `key`. A stored entry is reused with its key replaced. */
export function paperToBibtex(paper: BibPaperInput, key: string): string {
  return rawPaperToBibtex(toBibPaper(paper), key);
}

/** The `.bib` text for entries already rendered, one blank line apart. */
export function joinBibtex(entries: readonly string[]): string {
  return rawJoinBibtex([...entries]);
}

/** The whole library as one `.bib`, with the keys the export gives each paper. */
export function libraryBibtex(papers: readonly BibPaperInput[]): string {
  return rawLibraryBibtex(papers.map(toBibPaper));
}
