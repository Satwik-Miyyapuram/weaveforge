/**
 * The BibTeX half of the Overleaf export: cite keys for the LaTeX body, the
 * keys the body actually cites, and one `references.bib` entry per paper.
 */
import type { Paper } from "@weaveforge/core";
import {
  normalizeTitleKey,
  uniqueCiteKey,
} from "@weaveforge/core";

/** Build title→cite-key map used by markdown→LaTeX wikilink conversion. */
export function buildCiteByTitle(
  papers: readonly Paper[],
): { citeByTitle: Map<string, string>; keyByPaperId: Map<string, string> } {
  const used = new Set<string>();
  const citeByTitle = new Map<string, string>();
  const keyByPaperId = new Map<string, string>();
  for (const p of papers) {
    const key = uniqueCiteKey(p, used);
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
function escapeBibField(value: string): string {
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

/** `\cite{a,b}` — biblatex accepts a comma-separated key list in one command. */
const CITE_RE = /\\cite\{([^}]*)\}/g;

/**
 * Cite keys actually referenced by the generated body. Read back off the LaTeX
 * rather than tracked during the walk, so it stays correct however a citation
 * came to be emitted.
 */
export function collectCitedKeys(latex: string): Set<string> {
  const keys = new Set<string>();
  for (const match of latex.matchAll(CITE_RE)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const key = raw.trim();
      if (key) keys.add(key);
    }
  }
  return keys;
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

export function paperToBibtex(paper: Paper, key: string): string {
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
