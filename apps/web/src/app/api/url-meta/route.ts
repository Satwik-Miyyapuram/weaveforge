import { NextResponse } from "next/server";

/**
 * Extract paper metadata from an arbitrary URL.
 *
 * Fetches the page server-side (no CORS) and reads the citation meta tags that
 * academic sites embed — Highwire `citation_*` (used by arXiv, IEEE, ACM,
 * Springer, Google Scholar), Dublin Core `DC.*`, and OpenGraph as a fallback.
 * Returns normalized JSON the client maps to a paper.
 */
export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "url must be http(s)" }, { status: 400 });
  }

  // If the URL contains a DOI (e.g. dl.acm.org/doi/10.x, doi.org/10.x),
  // resolve via Crossref instead of scraping — many sites block bots outright.
  const doiInUrl = /10\.\d{4,9}\/[^\s?#"']+/.exec(decodeURIComponent(target))?.[0]
    ?.replace(/[).]+$/, "");
  if (doiInUrl) {
    const cr = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doiInUrl)}`, {
      headers: { "User-Agent": "thesis-tracker (mailto:noreply@example.com)" },
    });
    if (cr.ok) {
      const m = ((await cr.json()) as { message?: any }).message ?? {};
      const authors = (m.author ?? [])
        .map((a: any) => a.name ?? [a.given, a.family].filter(Boolean).join(" "))
        .filter((x: string) => x.length > 0);
      return NextResponse.json({
        title: (m.title?.[0] ?? doiInUrl).replace(/\s+/g, " "),
        authors,
        year: m.issued?.["date-parts"]?.[0]?.[0],
        venue: m["container-title"]?.[0],
        doi: m.DOI ?? doiInUrl,
        abstract: m.abstract?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
        url: m.URL ?? target,
      });
    }
    // Crossref miss — common for ACM placeholder 10.5555 DOIs.
    return NextResponse.json(
      { error: `DOI ${doiInUrl} not found in Crossref (some ACM DOIs are unregistered). Enter the paper manually or try the arXiv id.` },
      { status: 404 },
    );
  }

  const res = await fetch(parsed.toString(), {
    headers: {
      // Real browser UA — many publishers (Cloudflare) 403 bot-like agents.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    const hint =
      res.status === 403
        ? "the site blocked automated access — try the DOI or arXiv id instead"
        : res.status === 404
          ? "page not found"
          : `upstream returned ${res.status}`;
    return NextResponse.json({ error: `Could not read that URL: ${hint}.` }, { status: res.status });
  }
  const html = await res.text();
  return NextResponse.json(extractMetadata(html, parsed.toString()));
}

interface ExtractedMeta {
  title?: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  abstract?: string;
  url: string;
}

/** Read all <meta name=.. content=..> (and property=..) pairs from the head. */
function metaTags(html: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  const re = /<meta\b[^>]*>/gi;
  for (const [tag] of html.matchAll(re)) {
    const name =
      attr(tag, "name") ?? attr(tag, "property") ?? attr(tag, "itemprop");
    const content = attr(tag, "content");
    if (!name || content == null) continue;
    const key = name.toLowerCase();
    const list = tags.get(key) ?? [];
    list.push(decode(content));
    tags.set(key, list);
  }
  return tags;
}

function attr(tag: string, name: string): string | undefined {
  const m =
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag) ??
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return m?.[1];
}

function extractMetadata(html: string, url: string): ExtractedMeta {
  const m = metaTags(html);
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const v = m.get(k)?.[0]?.trim();
      if (v) return v;
    }
    return undefined;
  };

  const title =
    first("citation_title", "dc.title", "og:title", "twitter:title") ??
    htmlTitle(html);
  const authors = (
    m.get("citation_author") ??
    m.get("dc.creator") ??
    m.get("author") ??
    []
  )
    .map((a) => a.trim())
    .filter(Boolean);

  const dateStr = first(
    "citation_publication_date",
    "citation_date",
    "dc.date",
    "article:published_time",
  );
  const year = dateStr ? Number(/\d{4}/.exec(dateStr)?.[0]) || undefined : undefined;

  const doiRaw = first("citation_doi", "dc.identifier.doi", "doi");
  const doi = doiRaw?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();

  let arxivId = first("citation_arxiv_id")?.trim();
  if (!arxivId) {
    const am = /arxiv\.org\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(url);
    if (am) arxivId = am[1];
  }

  return {
    title: title?.replace(/\s+/g, " "),
    authors,
    year,
    venue: first("citation_journal_title", "citation_conference_title", "dc.source"),
    doi: doi || undefined,
    arxivId,
    abstract: first("citation_abstract", "dc.description", "og:description", "description")?.replace(/\s+/g, " "),
    url,
  };
}

function htmlTitle(html: string): string | undefined {
  return decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "") || undefined;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
