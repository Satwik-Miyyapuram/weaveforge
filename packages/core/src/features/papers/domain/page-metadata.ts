/**
 * Reading a paper's details off a web page.
 *
 * Two kinds of page carry a paper:
 *
 * - A publisher's or repository's article page, which embeds bibliographic
 *   tags: Highwire `citation_*` (arXiv, IEEE, ACM, Springer, Google Scholar)
 *   or Dublin Core `DC.*`.
 * - A page that *is* the paper: a research blog post, a Distill-style article,
 *   a lab's write-up, an essay. These rarely carry citation tags. They say what
 *   they are through schema.org JSON-LD (`Article`, `BlogPosting`,
 *   `ScholarlyArticle`…), OpenGraph `og:type=article`, or
 *   `article:published_time`.
 *
 * A page with neither is a home page, a search result or a bot wall, and is
 * not imported: a row called "Just a moment…" helps nobody.
 *
 * Pure string work, no DOM, so it runs on the server route, in the browser and
 * in the desktop shell alike.
 */

import { decodeHtmlEntities } from "../../../net/page-title.js";

export interface PageMetadata {
  title?: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  abstract?: string;
  url: string;
  /** The page carries bibliographic tags (Highwire / Dublin Core). */
  hasCitationMeta: boolean;
  /** The page says it is an article: JSON-LD, `og:type=article`, or a publish time. */
  isArticle: boolean;
}

/** Interstitials that answer 200 with an ordinary-looking title. */
export const BOT_WALL_TITLE =
  /client challenge|verifying your browser|just a moment|attention required|are you a robot|access denied|captcha|checking your browser/i;

/** schema.org types that are a piece of writing someone could cite. */
const ARTICLE_TYPES = new Set(
  [
    "article",
    "blogposting",
    "scholarlyarticle",
    "newsarticle",
    "techarticle",
    "report",
    "socialmediaposting",
    "creativework",
    "thesis",
  ].map((t) => t.toLowerCase()),
);

function attr(tag: string, name: string): string | undefined {
  const m =
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag) ??
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return m?.[1];
}

/** Every `<meta name|property|itemprop=… content=…>`, keyed in lower case. */
function metaTags(html: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = attr(tag, "name") ?? attr(tag, "property") ?? attr(tag, "itemprop");
    const content = attr(tag, "content");
    if (!name || content == null) continue;
    const key = name.toLowerCase();
    const list = tags.get(key) ?? [];
    list.push(decodeHtmlEntities(content));
    tags.set(key, list);
  }
  return tags;
}

type Json = unknown;

function asArray(v: Json): Json[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function text(v: Json): string | undefined {
  if (typeof v === "string") return decodeHtmlEntities(v).replace(/\s+/g, " ").trim() || undefined;
  return undefined;
}

function nameOf(v: Json): string | undefined {
  if (typeof v === "string") return text(v);
  if (v && typeof v === "object") return text((v as Record<string, Json>)["name"]);
  return undefined;
}

function typesOf(node: Record<string, Json>): string[] {
  return asArray(node["@type"]).filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
}

/** The article nodes in a page's JSON-LD, flattened out of `@graph` and arrays. */
function jsonLdArticles(html: string): Record<string, Json>[] {
  const out: Record<string, Json>[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const [, body] of html.matchAll(re)) {
    let parsed: Json;
    try {
      parsed = JSON.parse(body!.trim());
    } catch {
      continue; // A broken block on someone else's page is not our error.
    }
    const queue = asArray(parsed);
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;
      const rec = node as Record<string, Json>;
      queue.push(...asArray(rec["@graph"]));
      if (typesOf(rec).some((t) => ARTICLE_TYPES.has(t))) out.push(rec);
    }
  }
  return out;
}

function htmlTitle(html: string): string | undefined {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return raw ? text(raw) : undefined;
}

function yearOf(date: string | undefined): number | undefined {
  const y = date ? Number(/\b(1[89]\d\d|2\d{3})\b/.exec(date)?.[1]) : NaN;
  return Number.isFinite(y) ? y : undefined;
}

/**
 * A site suffix on a `<title>` or `og:title` ("Attention — Lil'Log") is the
 * site's name, not the article's. Dropped when the suffix is the site name
 * the page states.
 */
function stripSiteSuffix(title: string, siteName: string | undefined): string {
  if (!siteName) return title;
  const site = siteName.trim().toLowerCase();
  const m = /^(.*\S)\s+[|\-–—·:]\s+([^|\-–—·:]+)$/.exec(title);
  if (m && m[2]!.trim().toLowerCase() === site && m[1]!.length >= 4) return m[1]!;
  return title;
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Everything a page says about the paper it carries. */
export function extractPageMetadata(html: string, url: string): PageMetadata {
  const m = metaTags(html);
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const v = m.get(k)?.[0]?.trim();
      if (v) return v;
    }
    return undefined;
  };
  const ld = jsonLdArticles(html)[0];

  const siteName = first("og:site_name", "application-name") ?? nameOf(ld?.["publisher"]);
  const rawTitle =
    first("citation_title", "dc.title") ??
    text(ld?.["headline"]) ??
    text(ld?.["name"]) ??
    first("og:title", "twitter:title") ??
    htmlTitle(html);
  const title = rawTitle ? stripSiteSuffix(rawTitle.replace(/\s+/g, " "), siteName) : undefined;

  const ldAuthors = asArray(ld?.["author"]).map(nameOf).filter((a): a is string => !!a);
  const authors = unique(
    (m.get("citation_author") ?? m.get("dc.creator") ?? (ldAuthors.length ? ldAuthors : undefined) ??
      m.get("author") ?? m.get("article:author") ?? m.get("parsely-author") ?? [])
      .map((a) => a.trim())
      // `article:author` is often a profile URL rather than a name.
      .filter((a) => !/^https?:\/\//i.test(a)),
  );

  const date =
    first("citation_publication_date", "citation_date", "citation_online_date", "dc.date") ??
    text(ld?.["datePublished"]) ??
    first("article:published_time", "og:published_time", "date", "parsely-pub-date") ??
    text(ld?.["dateCreated"]);

  const hasCitationMeta = [...m.keys()].some((k) => k.startsWith("citation_") || k.startsWith("dc."));
  const isArticle =
    !!ld ||
    first("og:type")?.toLowerCase() === "article" ||
    !!first("article:published_time");

  const doiRaw = first("citation_doi", "dc.identifier.doi", "doi", "prism.doi");
  const doi = doiRaw?.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, "").trim() || undefined;

  let arxivId = first("citation_arxiv_id")?.trim();
  if (!arxivId) {
    const am = /arxiv\.org\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(url);
    if (am) arxivId = am[1];
  }

  return {
    title,
    authors,
    year: yearOf(date),
    venue:
      first("citation_journal_title", "citation_conference_title", "dc.source") ??
      (isArticle && !hasCitationMeta ? siteName : undefined),
    doi,
    arxivId: arxivId || undefined,
    abstract: (
      first("citation_abstract", "dc.description") ??
      text(ld?.["description"]) ??
      first("og:description", "description", "twitter:description")
    )?.replace(/\s+/g, " "),
    url,
    hasCitationMeta,
    isArticle,
  };
}

/**
 * Whether a page is worth importing as a paper, and if not, why — in words the
 * person pasting the link can act on.
 */
export function pageImportRefusal(meta: PageMetadata): string | null {
  if (BOT_WALL_TITLE.test(meta.title ?? "")) {
    return "That site blocked automated access. Import by DOI or arXiv id instead.";
  }
  if (!meta.title) return "That page has no title to file the paper under. Add the paper manually.";
  if (meta.hasCitationMeta || meta.isArticle) return null;
  return "That page does not look like a paper or an article — it has no citation tags and does not say it is an article. Import by DOI or arXiv id, or add the paper manually.";
}
