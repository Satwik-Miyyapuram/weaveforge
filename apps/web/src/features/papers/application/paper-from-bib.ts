/**
 * Papers from a `.bib` file (Zotero, Mendeley, Google Scholar, Paperpile exports).
 *
 * The Rust core reads the file and leaves out entries the library already has
 * by DOI or citation key; this saves the rest one by one. The add itself still
 * dedupes (arXiv id, DOI, then a long title), so a paper it hands back unmade is
 * reported as skipped, not added. Everything outside is injected, so the rules
 * here run in a plain test.
 */

import type { AddPaperResult, NewPaperInput, Paper } from "@weaveforge/core";
import type { BibImportPaper, BibImportPlan } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

/** The part of a `File` this needs. */
export interface BibFileLike {
  readonly name: string;
  text(): Promise<string>;
}

export interface BibImportDeps {
  plan(fileName: string, text: string, existingDois: string[], existingKeys: string[]): BibImportPlan | Promise<BibImportPlan>;
  listPapers(): Promise<Paper[]>;
  add(input: NewPaperInput): Promise<AddPaperResult>;
  /** Runs once for each paper that was made (note scaffold, Zotero push). */
  afterCreate(paper: Paper): Promise<void>;
}

/** One entry not imported, with the line of its `@` and why. */
export interface BibImportIssue {
  readonly key: string;
  readonly line: number;
  readonly reason: string;
}

export interface BibImportOutcome {
  readonly added: Paper[];
  readonly skipped: BibImportIssue[];
  readonly problems: BibImportIssue[];
}

/** The citation key a paper was imported or exported with, if any. */
function citeKeyOf(paper: Paper): string | undefined {
  const key = paper.metadata?.citeKey;
  return typeof key === "string" && key.trim() ? key : undefined;
}

/** A planned entry as the fields a new paper takes. */
export function bibPaperInput(entry: BibImportPaper): NewPaperInput {
  return {
    title: entry.title,
    authors: entry.authors,
    year: entry.year ?? undefined,
    venue: entry.venue ?? undefined,
    doi: entry.doi ?? undefined,
    arxivId: entry.arxivId ?? undefined,
    url: entry.url ?? undefined,
    abstract: entry.abstract ?? undefined,
    bibtex: entry.bibtex,
    metadata: { citeKey: entry.citationKey },
  };
}

/** Adds every new entry of a `.bib` file; one failed save does not stop the rest. */
export async function importBibFile(file: BibFileLike, deps: BibImportDeps): Promise<BibImportOutcome> {
  const library = await deps.listPapers();
  const dois = library.flatMap((p) => (p.doi ? [p.doi] : []));
  const keys = library.flatMap((p) => citeKeyOf(p) ?? []);
  const plan = await deps.plan(file.name, await file.text(), dois, keys);

  const added: Paper[] = [];
  const skipped: BibImportIssue[] = plan.skipped.map((s) => ({ key: s.key, line: s.line, reason: s.reason }));
  const problems: BibImportIssue[] = plan.problems.map((p) => ({ key: "", line: p.line, reason: p.message }));
  for (const entry of plan.papers) {
    const line = entry.line;
    try {
      const { paper, created } = await deps.add(bibPaperInput(entry));
      if (!created) {
        skipped.push({ key: entry.citationKey, line, reason: `Already in the library as "${paper.title}".` });
        continue;
      }
      await deps.afterCreate(paper);
      added.push(paper);
    } catch (err) {
      problems.push({ key: entry.citationKey, line, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { added, skipped, problems };
}

/** One line for a toast: what was added and what was not. */
export function bibImportMessage(outcome: BibImportOutcome): string {
  return readyCore().bibImportMessage(outcome.added.length, outcome.skipped.length, outcome.problems.length);
}

export function isBibFile(name: string): boolean {
  return readyCore().isBibFile(name);
}

/** A drop on Papers: `.bib` files are imported, everything else goes the PDF way (which skips non-PDFs). */
export function splitPaperDrop<F extends { readonly name: string }>(files: readonly F[]): { pdfs: F[]; bibs: F[] } {
  return { pdfs: files.filter((f) => !isBibFile(f.name)), bibs: files.filter((f) => isBibFile(f.name)) };
}
