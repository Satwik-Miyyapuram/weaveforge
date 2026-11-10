/**
 * "Find a free copy": ask the open-access indexes where a paper can be read,
 * then try what they list until one opens.
 *
 * PDFs first, because the reader's annotations, ink and citations work on a
 * PDF; then web pages, kept sanitised and shown in a sandboxed frame. A page
 * with only an abstract on it is not the paper and is passed over.
 *
 * Every step is injected, so the order and the bounds are tested without a
 * network. The messages and the ids are Rust (`reader::free_copy`); read them
 * through `readyCore()`.
 */

import type {
  OpenAccessCandidate,
  OpenAccessIds,
  OpenAccessLookup,
  OpenAccessSource,
} from "@weaveforge/core";
import type { PaperHtmlPage } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

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
  const webArticle = readyCore().isWebArticle(ids);

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
    const core = readyCore();
    const minChars = webArticle && candidate.source === "paper" ? core.minArticleTextChars() : core.minPaperTextChars();
    if (!core.isSubstantialPaperText(clean.text, minChars)) {
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
