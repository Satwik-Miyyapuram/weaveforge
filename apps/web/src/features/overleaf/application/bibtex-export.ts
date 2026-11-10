/**
 * The BibTeX half of the Overleaf export: cite keys for the LaTeX body, the
 * keys the body actually cites, and one `references.bib` entry per paper.
 * The entry rules live in Rust (`overleaf::bibtex`); these delegate to it.
 */
import type { Paper } from "@weaveforge/core";
import { paperCiteKeys } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

/** Build title→cite-key map used by markdown→LaTeX wikilink conversion. */
export function buildCiteByTitle(
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

/** The `.bib` text for entries already rendered, one blank line apart. */
export function joinBibtex(entries: readonly string[]): string {
  return readyCore().joinBibtex(entries);
}

/** The whole library as one `.bib`, with the keys the export gives each paper. */
export function libraryBibtex(papers: readonly Paper[]): string {
  return readyCore().libraryBibtex(papers);
}

/**
 * Cite keys actually referenced by the generated body. Read back off the LaTeX
 * rather than tracked during the walk, so it stays correct however a citation
 * came to be emitted.
 */
export function collectCitedKeys(latex: string): Set<string> {
  return readyCore().collectCitedKeys(latex);
}

/** One `references.bib` entry for `paper`, under the export's `key`. */
export function paperToBibtex(paper: Paper, key: string): string {
  return readyCore().paperToBibtex(paper, key);
}
