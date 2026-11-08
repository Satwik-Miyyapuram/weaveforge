import type { Paper } from "@weaveforge/core";

/** APA lists up to 20 authors; past that, the first 19, an ellipsis, the last. */
const MAX_AUTHORS = 20;

/** "Ann Marie Lee" or "Lee, Ann Marie" → "Lee, A. M."; one word stays as is. */
function apaName(raw: string): string {
  const name = raw.trim();
  let last: string;
  let given: string[];
  if (name.includes(",")) {
    const [family, rest = ""] = name.split(",", 2);
    last = family!.trim();
    given = rest.trim().split(/\s+/).filter(Boolean);
  } else {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return name;
    last = parts.pop()!;
    given = parts;
  }
  const initials = given.map((g) => `${g[0]!.toUpperCase()}.`).join(" ");
  return initials ? `${last}, ${initials}` : last;
}

function authorList(authors: readonly string[]): string {
  const names = authors.map(apaName).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length > MAX_AUTHORS) return `${names.slice(0, MAX_AUTHORS - 1).join(", ")}, . . . ${names.at(-1)}`;
  return `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;
}

/** End a part with a full stop unless it already ends in one (or ? / !). */
function sentence(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

function link(paper: Paper): string {
  const doi = paper.doi?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (doi) return `https://doi.org/${doi}`;
  const arxiv = paper.arxivId?.trim().replace(/^arxiv:/i, "");
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`;
  return paper.url?.trim() ?? "";
}

/**
 * A paper as a reference ready to paste into a document, in APA style:
 * `Lee, A., & Chen, B. (2020). Title. Venue. https://doi.org/…`.
 */
export function formatReference(paper: Paper): string {
  const authors = authorList(paper.authors);
  const year = `(${paper.year ?? "n.d."}).`;
  const title = sentence(paper.title.trim());
  const venue = paper.venue?.trim();
  const parts = authors ? [sentence(authors), year, title] : [title, year];
  if (venue) parts.push(sentence(venue));
  const url = link(paper);
  if (url) parts.push(url);
  return parts.join(" ");
}
