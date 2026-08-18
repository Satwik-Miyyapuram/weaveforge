/**
 * Reading a page's title out of its HTML.
 *
 * Pure, so the same reading happens in the API route and in the Electron main
 * process, and so it can be tested against the awkward pages — the ones with a
 * bot wall, an entity-encoded title, or a title element that never closes —
 * without a network.
 */

/** The named entities a title actually contains, plus numeric escapes. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => safeCodePoint(Number(digits)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0?39;/g, "'")
    // Ampersand last, so `&amp;lt;` decodes to `&lt;` and not to `<`.
    .replace(/&amp;/gi, "&");
}

function safeCodePoint(value: number): string {
  // A malformed escape is left as nothing rather than throwing: a title is
  // decoration, and one bad character is not worth losing the page over.
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/**
 * Titles a site shows a robot rather than a reader.
 *
 * A challenge page answers 200 with a perfectly ordinary `<title>`, so without
 * this a pasted link becomes `[Just a moment…](…)` — which is worse than the
 * bare URL, because it looks like it worked.
 */
const BOT_WALL =
  /^\s*(?:just a moment|attention required|access denied|client challenge|verifying your browser|are you a robot|checking your browser|please wait|security check|redirecting|error \d{3}|\d{3} (?:forbidden|not found))\b/i;

/** Longer than this is a page dumping its whole description into the title. */
const MAX_TITLE = 300;

export interface PageTitle {
  title: string;
  /** True when the title looks like a challenge page rather than the article. */
  suspect: boolean;
}

/**
 * The best title the HTML offers.
 *
 * OpenGraph first, because a site that sets it has said what the page should be
 * called when somebody links to it — which is exactly the question being asked
 * here. `<title>` is the fallback, and it often carries the site name as a
 * suffix, which is left alone: guessing which half is the separator gets the
 * wrong answer on any title with a dash in it.
 */
export function extractPageTitle(html: string): PageTitle | null {
  // Only the head is worth scanning, and a page can be megabytes.
  const head = html.slice(0, 200_000);

  const og =
    metaContent(head, "og:title") ??
    metaContent(head, "twitter:title") ??
    metaContent(head, "citation_title") ??
    metaContent(head, "dc.title");

  const raw = og ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  if (raw === undefined) return null;

  const title = decodeHtmlEntities(raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);
  if (!title) return null;

  return { title, suspect: BOT_WALL.test(title) };
}

/** The content of a `<meta>` tag by name, property or itemprop. */
function metaContent(html: string, wanted: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = attribute(tag, "property") ?? attribute(tag, "name") ?? attribute(tag, "itemprop");
    if (!name || name.toLowerCase() !== wanted.toLowerCase()) continue;
    const content = attribute(tag, "content");
    if (content) return content;
  }
  return undefined;
}

function attribute(tag: string, name: string): string | undefined {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  if (quoted) return quoted[1];
  const single = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  if (single) return single[1];
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  return bare?.[1];
}

/**
 * True when a URL's own path says it points at an image.
 *
 * Used to decide whether a pasted link is a picture worth downloading. The
 * extension is the only signal available before the request, and a URL with no
 * extension is left alone rather than fetched to find out — a note is not a
 * reason to request every link somebody pastes.
 */
export function looksLikeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
