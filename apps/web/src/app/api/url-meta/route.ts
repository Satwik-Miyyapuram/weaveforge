import { NextResponse } from "next/server";
import { extractDoi, normalizeArxivId } from "@weaveforge/core";

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
    // A scheme-less host (`nature.com/articles/…`) is a URL the user meant;
    // assume https rather than rejecting it. The protocol guard below still
    // runs, so this cannot smuggle in a file:/ftp: target.
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "url must be http(s)" }, { status: 400 });
  }

  // arXiv URLs: use the arXiv API rather than scraping the abs page. The page
  // does carry citation meta tags, but the API is stable, gives the abstract
  // in full, and never trips a bot wall.
  const arxivInUrl = normalizeArxivId(target);
  if (arxivInUrl) {
    const meta = await fetchArxiv(arxivInUrl, target);
    if (meta) return NextResponse.json(meta);
    // Fall through to scraping if arXiv is unreachable.
  }

  // If the URL contains a DOI (e.g. dl.acm.org/doi/10.x, doi.org/10.x),
  // resolve via Crossref instead of scraping — many sites block bots outright.
  const doiInUrl = extractDoi(target);
  if (doiInUrl) {
    const cr = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doiInUrl)}`, {
      headers: { "User-Agent": "weaveforge (mailto:noreply@example.com)" },
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
  const meta = extractMetadata(html, parsed.toString());

  // A 200 does not mean we got the paper. Cloudflare/Datadome interstitials
  // ("Client Challenge", "Verifying your browser") answer 200 with a normal
  // <title> and no citation tags — importing that would file a paper called
  // "Client Challenge". Refuse anything that carries no citation metadata.
  if (!meta.hasCitationMeta) {
    const wall = BOT_WALL_TITLE.test(meta.title ?? "");
    return NextResponse.json(
      {
        error: wall
          ? "That site blocked automated access. Import by DOI or arXiv id instead."
          : "No citation metadata found on that page. Import by DOI or arXiv id, or add the paper manually.",
      },
      { status: 422 },
    );
  }
  return NextResponse.json(meta);
}

async function fetchArxiv(id: string, url: string): Promise<ExtractedMeta | null> {
  const res = await fetch(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
  ).catch(() => null);
  if (!res?.ok) return null;
  const xml = await res.text();
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return null;
  const pick = (tag: string) =>
    decode(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1]?.trim() ?? "");
  const title = pick("title").replace(/\s+/g, " ");
  if (!title) return null;
  const published = pick("published");
  const doi = /<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/.exec(entry)?.[1]?.trim();
  return {
    title,
    authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)]
      .map((m) => decode(m[1]?.trim() ?? ""))
      .filter(Boolean),
    year: published ? Number(published.slice(0, 4)) || undefined : undefined,
    doi: doi || undefined,
    arxivId: id,
    abstract: pick("summary").replace(/\s+/g, " ") || undefined,
    url,
    hasCitationMeta: true,
  };
}

const BOT_WALL_TITLE =
  /client challenge|verifying your browser|just a moment|attention required|are you a robot|access denied|captcha|checking your browser/i;

interface ExtractedMeta {
  title?: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  abstract?: string;
  url: string;
  /** True when the page carried real bibliographic tags (Highwire / Dublin
   *  Core), as opposed to only an OpenGraph or <title> fallback. */
  hasCitationMeta: boolean;
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

  const hasCitationMeta = [...m.keys()].some(
    (k) => k.startsWith("citation_") || k.startsWith("dc."),
  );

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
    hasCitationMeta,
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
