import { NextResponse } from "next/server";
import {
  decodeHtmlEntities,
  extractDoi,
  extractPageMetadata,
  normalizeArxivId,
  pageImportRefusal,
  type PageMetadata,
} from "@weaveforge/core";
import { safeFetch } from "@/backend/net/safe-fetch";

/** The slice of a Crossref `works` record this route reads. */
type CrossrefWork = {
  author?: { name?: string; given?: string; family?: string }[];
  title?: string[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  DOI?: string;
  abstract?: string;
  URL?: string;
};


/**
 * Reading paper metadata off an arbitrary URL.
 *
 * Lives outside `route.ts` for two reasons. A Next.js App Router route module
 * may only export route handlers, so the pieces below could not be reached from
 * a test through it; and separating them lets `route.ts` be nothing but the
 * authentication gate, which is where an argument about who may call this
 * belongs. `pdf-proxy` is split the same way and for the same reasons.
 *
 * The route reads the citation meta tags academic sites embed — Highwire
 * `citation_*` (arXiv, IEEE, ACM, Springer, Google Scholar), Dublin Core `DC.*`,
 * schema.org JSON-LD (`ScholarlyArticle`, `BlogPosting`, `Article`) for blog
 * and article pages, and OpenGraph as a fallback — and returns normalised JSON
 * the client maps to a paper. A page with neither citation tags nor an article
 * marker, with no title, or behind a bot wall is refused by `pageImportRefusal`
 * rather than stored under a placeholder title. Any host may be asked for;
 * `safeFetch` resolves it, refuses private addresses and re-checks each
 * redirect.
 */

/** How long the two fixed-host lookups may take before we give up on them. */
const FIXED_HOST_TIMEOUT_MS = 10_000;

/**
 * A fetch of one of our own fixed hosts, with a deadline.
 *
 * Crossref and arXiv are not addresses a visitor chose, so they need no address
 * guard — but they are still someone else's servers, and `fetch` with no signal
 * waits for as long as they care to take. Without this a slow Crossref holds a
 * request open indefinitely.
 */
async function fetchFixedHost(url: string, init: RequestInit = {}): Promise<Response | null> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FIXED_HOST_TIMEOUT_MS) }).catch(
    () => null,
  );
}

export async function resolveUrlMetadata(target: string | null) {
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
    // Crossref is our own fixed host, not one the visitor chose, so no guard is
    // needed here — only the DOI is theirs, and it is encoded into the path.
    const cr = await fetchFixedHost(`https://api.crossref.org/works/${encodeURIComponent(doiInUrl)}`, {
      headers: { "User-Agent": "weaveforge (mailto:noreply@example.com)" },
    });
    if (cr?.ok) {
      const m = ((await cr.json()) as { message?: CrossrefWork }).message ?? {};
      const authors = (m.author ?? [])
        .map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" "))
        .filter((x) => x.length > 0);
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

  // Guarded, and every redirect hop guarded with it. This used to be a plain
  // `fetch(..., { redirect: "follow" })`, which is a request made from inside
  // the network to an address the visitor chose — including a 302 to the cloud
  // metadata endpoint, which hands back instance credentials.
  const res = await safeFetch(parsed.toString(), {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });
  if (!res.ok) {
    const hint =
      res.status === 403
        ? `${res.message} Try the DOI or arXiv id instead.`
        : res.message;
    return NextResponse.json({ error: hint }, { status: res.status });
  }
  const html = new TextDecoder().decode(res.body);
  const meta = extractPageMetadata(html, res.url);

  // A 200 does not mean we got a paper. Cloudflare/Datadome interstitials
  // ("Client Challenge", "Verifying your browser") answer 200 with a normal
  // <title> — importing that would file a paper called "Client Challenge". A
  // page counts when it carries citation tags, or says it is an article (a
  // research blog post, an essay, a Distill-style write-up).
  const refusal = pageImportRefusal(meta);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 422 });
  return NextResponse.json(meta);
}

async function fetchArxiv(id: string, url: string): Promise<ExtractedMeta | null> {
  // arXiv's own API, a fixed host: the visitor supplies the id, not the address.
  const res = await fetchFixedHost(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
  );
  if (!res?.ok) return null;
  const xml = await res.text();
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return null;
  const pick = (tag: string) =>
    decodeHtmlEntities(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1]?.trim() ?? "");
  const title = pick("title").replace(/\s+/g, " ");
  if (!title) return null;
  const published = pick("published");
  const doi = /<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/.exec(entry)?.[1]?.trim();
  return {
    title,
    authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)]
      .map((m) => decodeHtmlEntities(m[1]?.trim() ?? ""))
      .filter(Boolean),
    year: published ? Number(published.slice(0, 4)) || undefined : undefined,
    doi: doi || undefined,
    arxivId: id,
    abstract: pick("summary").replace(/\s+/g, " ") || undefined,
    url,
    hasCitationMeta: true,
  };
}

type ExtractedMeta = Omit<PageMetadata, "isArticle"> & { isArticle?: boolean };
