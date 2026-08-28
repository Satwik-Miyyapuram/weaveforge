/**
 * The two questions a compiler will not answer, and the ones it answers late.
 *
 * LaTeX tells you about a missing entry as an undefined-reference warning
 * buried in a log, and it never tells you about an entry you carried around for
 * a year and never cited. Both are answerable from the sources alone, with no
 * compiler, no network and no model — which is the reason this is a pure
 * function in `core` and not a service.
 *
 * Everything here is a finding, never an exception. A bibliography that cannot
 * be read is the bibliography most in need of reading, so a parse failure is
 * reported alongside the rest rather than replacing them.
 */

import type { BibEntry, BibParseResult } from "./bib-entries.js";
import type { LatexSourceFile } from "./latex-section-tree.js";

export type BibFindingKind =
  | "cited-not-defined"
  | "defined-not-cited"
  | "duplicate-key"
  | "missing-field"
  | "malformed-doi"
  | "malformed-url"
  | "author-format"
  | "missing-bib-file"
  | "parse-warning";

export interface BibFinding {
  kind: BibFindingKind;
  /** An error breaks the document or the bibliography; a warning is untidy. */
  severity: "error" | "warning";
  file: string;
  /** 1-based. */
  line: number;
  message: string;
  /** The cite key the finding is about, when it is about one. */
  key?: string;
}

export interface BibliographyInput {
  /** Every text file of the project — `.tex` and `.bib` alike. */
  sources: readonly LatexSourceFile[];
  bibliography: BibParseResult;
}

export interface BibliographyReport {
  findings: BibFinding[];
  /** Distinct keys cited anywhere in the document. */
  citedKeys: string[];
  entryCount: number;
  /** True when `\nocite{*}` makes every entry cited by definition. */
  citesEverything: boolean;
}

/**
 * Citation commands, natbib and biblatex together.
 *
 * Matched by suffix rather than enumerated exhaustively: every package in
 * common use spells its commands `\...cite...`, and a command this misses is a
 * false "never cited", which is the more annoying of the two ways to be wrong.
 */
const CITE_COMMAND = /\\([A-Za-z]*[Cc]ite[A-Za-z]*)\*?((?:\s*\[[^\]]*\])*)\s*\{([^{}]*)\}/g;

/** Where a bibliography file is named. */
const BIB_RESOURCE = /\\(?:bibliography|addbibresource)\s*\{([^{}]*)\}/g;

/**
 * What each entry type has to carry to render.
 *
 * `|` means either is enough. These are BibTeX's requirements with biblatex's
 * spellings accepted alongside them — `date` for `year`, `journaltitle` for
 * `journal` — because a thesis written this decade is as likely to use one as
 * the other, and reporting a missing `year` on an entry that has a `date` is
 * how a checker teaches people to ignore it.
 */
const REQUIRED: Record<string, string[]> = {
  article: ["author", "title", "journal|journaltitle", "year|date"],
  book: ["author|editor", "title", "publisher", "year|date"],
  booklet: ["title"],
  inbook: ["author|editor", "title", "chapter|pages", "publisher", "year|date"],
  incollection: ["author", "title", "booktitle", "publisher", "year|date"],
  inproceedings: ["author", "title", "booktitle", "year|date"],
  conference: ["author", "title", "booktitle", "year|date"],
  manual: ["title"],
  mastersthesis: ["author", "title", "school|institution", "year|date"],
  phdthesis: ["author", "title", "school|institution", "year|date"],
  thesis: ["author", "title", "school|institution", "year|date"],
  proceedings: ["title", "year|date"],
  techreport: ["author", "title", "institution", "year|date"],
  report: ["author", "title", "institution", "year|date"],
  unpublished: ["author", "title", "note"],
  online: ["title", "url|doi"],
  misc: [],
};

/** A DOI, with or without the resolver in front of it. */
const DOI_BODY = /^10\.\d{4,9}\/\S+$/;

function isTex(file: LatexSourceFile): boolean {
  const path = file.path.toLowerCase();
  return path.endsWith(".tex") || path.endsWith(".ltx");
}

/**
 * Strip comments before looking for citations.
 *
 * A commented-out paragraph is the usual home of a cite key that was replaced,
 * and counting it would report the old entry as still needed. `\%` is an
 * escaped percent and starts nothing.
 */
function withoutComments(line: string): string {
  const at = line.search(/(?<!\\)%/);
  return at < 0 ? line : line.slice(0, at);
}

interface Citation {
  key: string;
  file: string;
  line: number;
}

function collectCitations(sources: readonly LatexSourceFile[]): {
  citations: Citation[];
  citesEverything: boolean;
  resources: { name: string; file: string; line: number }[];
} {
  const citations: Citation[] = [];
  const resources: { name: string; file: string; line: number }[] = [];
  let citesEverything = false;

  for (const file of sources) {
    if (!isTex(file)) continue;
    file.content.split("\n").forEach((raw, index) => {
      const line = withoutComments(raw);
      for (const [, , , group] of line.matchAll(CITE_COMMAND)) {
        for (const part of (group as string).split(",")) {
          const key = part.trim();
          if (!key) continue;
          if (key === "*") citesEverything = true;
          else citations.push({ key, file: file.path, line: index + 1 });
        }
      }
      for (const [, named] of line.matchAll(BIB_RESOURCE)) {
        for (const part of (named as string).split(",")) {
          const name = part.trim();
          if (name) resources.push({ name, file: file.path, line: index + 1 });
        }
      }
    });
  }
  return { citations, citesEverything, resources };
}

function hasField(entry: BibEntry, requirement: string): boolean {
  return requirement.split("|").some((name) => Boolean(entry.fields[name]?.trim()));
}

function checkFields(entry: BibEntry, findings: BibFinding[]): void {
  const required = REQUIRED[entry.type];
  // An unknown entry type is somebody's local style, not a mistake to report.
  if (required) {
    for (const requirement of required) {
      if (hasField(entry, requirement)) continue;
      const names = requirement.split("|").join("' or '");
      findings.push({
        kind: "missing-field",
        severity: "error",
        file: entry.file,
        line: entry.line,
        key: entry.key,
        message: `@${entry.type} '${entry.key}' has no '${names}'.`,
      });
    }
  }

  const doi = entry.fields["doi"]?.trim();
  if (doi && !DOI_BODY.test(doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""))) {
    findings.push({
      kind: "malformed-doi",
      severity: "warning",
      file: entry.file,
      line: entry.line,
      key: entry.key,
      message: `'${entry.key}' has a DOI that is not one: ${doi}`,
    });
  }

  const url = entry.fields["url"]?.trim();
  if (url && !/^(?:https?|ftp):\/\/[^\s]+\.[^\s]+$/i.test(url)) {
    findings.push({
      kind: "malformed-url",
      severity: "warning",
      file: entry.file,
      line: entry.line,
      key: entry.key,
      message: `'${entry.key}' has a URL that will not resolve: ${url}`,
    });
  }
}

/**
 * Whether authors are written "Last, First" or "First Last" — and whether the
 * file has settled on one.
 *
 * Reported once for the file rather than once per entry: the finding is the
 * inconsistency, and a person fixing it wants the list of odd ones out, not
 * forty identical lines.
 */
function checkAuthorStyle(entries: readonly BibEntry[], findings: BibFinding[]): void {
  const commaStyle: BibEntry[] = [];
  const plainStyle: BibEntry[] = [];
  for (const entry of entries) {
    const authors = entry.fields["author"]?.trim();
    if (!authors) continue;
    const names = authors.split(/\s+and\s+/i).filter(Boolean);
    if (!names.length) continue;
    // "others" is BibTeX's et al. and carries no name to be formatted.
    const named = names.filter((name) => name.trim().toLowerCase() !== "others");
    if (!named.length) continue;
    (named.every((name) => name.includes(",")) ? commaStyle : plainStyle).push(entry);
  }
  if (!commaStyle.length || !plainStyle.length) return;

  const minority = commaStyle.length < plainStyle.length ? commaStyle : plainStyle;
  const majorityStyle = minority === commaStyle ? "First Last" : "Last, First";
  for (const entry of minority) {
    findings.push({
      kind: "author-format",
      severity: "warning",
      file: entry.file,
      line: entry.line,
      key: entry.key,
      message: `'${entry.key}' writes its authors the other way round; the rest of this bibliography uses '${majorityStyle}'.`,
    });
  }
}

function checkResources(
  resources: readonly { name: string; file: string; line: number }[],
  sources: readonly LatexSourceFile[],
  findings: BibFinding[],
): void {
  const present = new Set(sources.map((file) => file.path.toLowerCase()));
  for (const resource of resources) {
    const name = resource.name.toLowerCase();
    const candidates = [name, name.endsWith(".bib") ? name : `${name}.bib`];
    // A path may be written relative to the file that names it or to the root.
    const found = candidates.some((candidate) =>
      [...present].some((path) => path === candidate || path.endsWith(`/${candidate}`)),
    );
    if (found) continue;
    findings.push({
      kind: "missing-bib-file",
      severity: "error",
      file: resource.file,
      line: resource.line,
      message: `No '${resource.name}' in this project, so none of its entries will print.`,
    });
  }
}

/** Errors before warnings, then by file and line, so the list reads top-down. */
function order(a: BibFinding, b: BibFinding): number {
  if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
  return a.file.localeCompare(b.file) || a.line - b.line;
}

/**
 * Check one project's citations against its bibliography.
 *
 * Pure: give it the files and the parsed entries, and it answers the same way
 * every time.
 */
export function checkBibliography(input: BibliographyInput): BibliographyReport {
  const findings: BibFinding[] = [];
  const { entries, warnings } = input.bibliography;
  const { citations, citesEverything, resources } = collectCitations(input.sources);

  for (const warning of warnings) {
    findings.push({
      kind: "parse-warning",
      severity: "warning",
      file: warning.file,
      line: warning.line,
      message: warning.message,
    });
  }

  const byKey = new Map<string, BibEntry[]>();
  for (const entry of entries) {
    const seen = byKey.get(entry.key);
    if (seen) seen.push(entry);
    else byKey.set(entry.key, [entry]);
  }

  for (const [key, group] of byKey) {
    // The first definition is the one biber keeps; the rest are the problem.
    for (const duplicate of group.slice(1)) {
      const first = group[0] as BibEntry;
      findings.push({
        kind: "duplicate-key",
        severity: "error",
        file: duplicate.file,
        line: duplicate.line,
        key,
        message: `'${key}' is already defined at ${first.file}:${first.line}; this one is ignored.`,
      });
    }
  }

  for (const entry of entries) checkFields(entry, findings);
  checkAuthorStyle(entries, findings);
  checkResources(resources, input.sources, findings);

  const cited = new Set<string>();
  const reportedMissing = new Set<string>();
  for (const citation of citations) {
    cited.add(citation.key);
    if (byKey.has(citation.key)) continue;
    // Once per key per file: a key cited forty times is one thing to fix.
    const at = `${citation.key}\u0000${citation.file}`;
    if (reportedMissing.has(at)) continue;
    reportedMissing.add(at);
    findings.push({
      kind: "cited-not-defined",
      severity: "error",
      file: citation.file,
      line: citation.line,
      key: citation.key,
      message: `'${citation.key}' is cited here but defined in no .bib file.`,
    });
  }

  if (!citesEverything) {
    for (const entry of entries) {
      if (cited.has(entry.key)) continue;
      findings.push({
        kind: "defined-not-cited",
        severity: "warning",
        file: entry.file,
        line: entry.line,
        key: entry.key,
        message: `'${entry.key}' is never cited, so it will not appear in the bibliography.`,
      });
    }
  }

  findings.sort(order);
  return {
    findings,
    citedKeys: [...cited].sort(),
    entryCount: entries.length,
    citesEverything,
  };
}
