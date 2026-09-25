/**
 * "Find a free copy": ask the open-access indexes where a paper can be read,
 * then try what they list until one opens.
 *
 * PDFs first, because the reader's annotations, ink and citations work on a
 * PDF; then web pages, kept sanitised and shown in a sandboxed frame. A page
 * with only an abstract on it is not the paper and is passed over.
 *
 * Every step is injected, so the order, the bounds and above all the messages
 * are tested without a network. The messages matter: "nothing found", "an
 * index could not be reached" and "found, but the site would not give it up"
 * are three different situations with three different things to do next.
 */

import type {
  OpenAccessCandidate,
  OpenAccessIds,
  OpenAccessLookup,
  OpenAccessSource,
} from "@weaveforge/core";
import { isSubstantialPaperText, MIN_ARTICLE_TEXT_CHARS, MIN_PAPER_TEXT_CHARS, type PaperHtmlPage } from "./paper-html";

export type PdfAttempt = { ok: true } | { ok: false; reason: "no-cache" | "not-pdf" | "blocked" | "failed" };

export type HtmlFetchResult =
  | { ok: true; raw: string; finalUrl: string }
  | { ok: false; reason: "blocked" | "not-html" | "failed"; status?: number };

export interface FreeCopyDeps {
  lookup(ids: OpenAccessIds): Promise<OpenAccessLookup>;
  fetchPdf(paperId: string, url: string): Promise<PdfAttempt>;
  fetchHtml(url: string): Promise<HtmlFetchResult>;
  sanitize(raw: string, baseUrl: string): { html: string; text: string; title: string };
  saveHtml(page: PaperHtmlPage): Promise<void>;
  now?: () => Date;
}

/** Why a listed copy did not open, in words a reader can act on. */
export type AttemptReason = "not-pdf" | "not-html" | "blocked" | "failed" | "abstract-only" | "no-storage";

export interface FreeCopyAttempt {
  url: string;
  format: OpenAccessCandidate["format"];
  reason: AttemptReason;
}

export type FreeCopyOutcome =
  | { kind: "pdf"; candidate: OpenAccessCandidate }
  | { kind: "html"; candidate: OpenAccessCandidate; page: PaperHtmlPage }
  | {
      kind: "none";
      listed: number;
      attempts: FreeCopyAttempt[];
      /** Indexes asked that did not answer. */
      unreachable: OpenAccessSource[];
      /** Indexes asked at all. */
      asked: OpenAccessSource[];
    };

/** At most this many of each format are tried; the rest are rarely different copies. */
export const MAX_PDF_ATTEMPTS = 6;
export const MAX_HTML_ATTEMPTS = 4;

export async function findFreeCopy(
  paperId: string,
  ids: OpenAccessIds,
  deps: FreeCopyDeps,
): Promise<FreeCopyOutcome> {
  const lookup = await deps.lookup(ids);
  const attempts: FreeCopyAttempt[] = [];
  const pdfs = lookup.candidates.filter((c) => c.format === "pdf").slice(0, MAX_PDF_ATTEMPTS);
  const pages = lookup.candidates.filter((c) => c.format === "html").slice(0, MAX_HTML_ATTEMPTS);
  const webArticle = isWebArticle(ids);

  for (const candidate of pdfs) {
    let result: PdfAttempt;
    try {
      result = await deps.fetchPdf(paperId, candidate.url);
    } catch {
      result = { ok: false, reason: "failed" };
    }
    if (result.ok) return { kind: "pdf", candidate };
    attempts.push({ url: candidate.url, format: "pdf", reason: result.reason === "no-cache" ? "no-storage" : result.reason });
    // Nowhere to keep a PDF means nowhere to keep any of them.
    if (result.reason === "no-cache") break;
  }

  for (const candidate of pages) {
    let fetched: HtmlFetchResult;
    try {
      fetched = await deps.fetchHtml(candidate.url);
    } catch {
      fetched = { ok: false, reason: "failed" };
    }
    if (!fetched.ok) {
      attempts.push({ url: candidate.url, format: "html", reason: fetched.reason });
      continue;
    }
    const clean = deps.sanitize(fetched.raw, fetched.finalUrl);
    const minChars = webArticle && candidate.source === "paper" ? MIN_ARTICLE_TEXT_CHARS : MIN_PAPER_TEXT_CHARS;
    if (!isSubstantialPaperText(clean.text, minChars)) {
      attempts.push({ url: candidate.url, format: "html", reason: "abstract-only" });
      continue;
    }
    const page: PaperHtmlPage = {
      paperId,
      url: fetched.finalUrl,
      title: clean.title,
      html: clean.html,
      savedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    try {
      await deps.saveHtml(page);
    } catch {
      attempts.push({ url: candidate.url, format: "html", reason: "no-storage" });
      continue;
    }
    return { kind: "html", candidate, page };
  }

  return {
    kind: "none",
    listed: lookup.candidates.length,
    attempts,
    unreachable: lookup.failed,
    asked: lookup.asked,
  };
}

const SOURCE_NAMES: Record<OpenAccessSource, string> = {
  paper: "the paper's own link",
  arxiv: "arXiv",
  openalex: "OpenAlex",
  unpaywall: "Unpaywall",
  "semantic-scholar": "Semantic Scholar",
  "europe-pmc": "Europe PMC",
  biorxiv: "bioRxiv / medRxiv",
  doaj: "DOAJ",
  zenodo: "Zenodo",
  hal: "HAL",
};

const REASON_WORDS: Record<AttemptReason, string> = {
  "not-pdf": "did not answer with a PDF",
  "not-html": "did not answer with a page",
  blocked: "does not let the browser fetch it",
  failed: "could not be reached",
  "abstract-only": "has only the abstract",
  "no-storage": "could not be kept on this device",
};

/** Pages go through a relay, so a blocked page is the site saying no, not CORS. */
function reasonWords(attempt: FreeCopyAttempt): string {
  return attempt.format === "html" && attempt.reason === "blocked" ? "refused to send it" : REASON_WORDS[attempt.reason];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The message for a search that opened nothing. Says what was found, what was
 * tried and why each failed, and which indexes were not asked because they
 * could not be reached — never "no free copy" when the truth is "could not
 * look".
 */
export function describeFreeCopyFailure(
  outcome: Extract<FreeCopyOutcome, { kind: "none" }>,
  webArticle = false,
): string {
  const own = webArticle ? outcome.attempts.find((a) => a.format === "html") : undefined;
  if (own) {
    const why = own.reason === "abstract-only" ? "has too little text to be the article" : reasonWords(own);
    return `The page on ${hostOf(own.url)} ${why}. Load a PDF of it instead, or open it in a browser.`;
  }
  const unreachable = outcome.unreachable.map((s) => SOURCE_NAMES[s]);
  if (outcome.listed === 0) {
    if (outcome.asked.length === 0) {
      return "This paper has no DOI, arXiv id or PubMed Central id to look it up by. Add one, or paste the PDF's address.";
    }
    if (unreachable.length >= outcome.asked.length) {
      return "None of the open-access indexes could be reached. Check the connection and try again.";
    }
    const base = "No open-access index lists a free copy of this paper.";
    return unreachable.length
      ? `${base} ${listNames(unreachable)} could not be reached, so try again later.`
      : base;
  }
  const noStorage = outcome.attempts.some((a) => a.reason === "no-storage");
  if (noStorage) return "A free copy was found but could not be kept here — open a workspace folder first.";
  const tried = outcome.attempts
    .slice(0, 4)
    .map((a) => `${hostOf(a.url)} ${reasonWords(a)}`)
    .join("; ");
  const copies = outcome.listed === 1 ? "1 possible free copy" : `${outcome.listed} possible free copies`;
  let message = `Found ${copies}, but none opened: ${tried}.`;
  if (outcome.attempts.some((a) => a.format === "pdf" && a.reason === "blocked")) {
    message += " Download it in a browser and use Load PDF…";
  }
  if (unreachable.length) message += ` ${listNames(unreachable)} could not be reached.`;
  return message;
}

/**
 * A paper that is a web page and nothing else: a blog post or an essay with
 * no DOI, arXiv id or PMCID. Its own page is the paper, not a landing page in
 * front of one, so it is opened as it is.
 */
export function isWebArticle(ids: OpenAccessIds): boolean {
  return !!ids.pageUrl && !ids.doi && !ids.arxivId && !ids.pmcid;
}

/** The ids a paper offers the indexes, and its own link. */
export function openAccessIdsOf(paper: {
  doi?: string | null;
  arxivId?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
}): OpenAccessIds {
  const pmcid = paper.metadata?.["pmcid"];
  const url = paper.url && /^https?:\/\//i.test(paper.url) ? paper.url : undefined;
  const isPdf = !!url && /\.pdf(?:$|[?#])|\/pdf\//i.test(url);
  return {
    doi: paper.doi ?? undefined,
    arxivId: paper.arxivId ?? undefined,
    pmcid: typeof pmcid === "string" ? pmcid : undefined,
    knownPdfUrl: isPdf ? url : undefined,
    pageUrl: url && !isPdf ? url : undefined,
  };
}
