/**
 * A paper kept as a web page: what is stored, how it is framed for reading,
 * and how the stored file is read back.
 *
 * Some papers have no PDF anyone may read but a full text on the web — arXiv's
 * HTML rendering, PubMed Central, an open-access journal's article page. The
 * reader fetches that page once (see `find-free-copy.ts`), keeps the sanitised
 * article (`sanitize-paper-html.ts`) and shows it in a sandboxed frame with no
 * scripts, no same-origin access and no network beyond images.
 *
 * This file is pure — no DOM — so the framing and the file format are tested
 * without a browser.
 */

export interface PaperHtmlPage {
  paperId: string;
  /** The address the page was fetched from, after redirects. */
  url: string;
  title: string;
  /** The sanitised article markup: no scripts, forms, frames or handlers. */
  html: string;
  /** ISO time it was fetched. */
  savedAt: string;
}

/**
 * How much text a page must carry to count as the paper.
 *
 * A landing page with only the abstract is a few hundred words; the shortest
 * full papers are several thousand characters. Below this a page is taken for
 * the landing page it probably is, and the next candidate is tried.
 */
export const MIN_PAPER_TEXT_CHARS = 5000;

/**
 * A paper that *is* a web page — a blog post, an essay, a lab's write-up — has
 * no longer full text elsewhere to hold out for, and a good post can be short.
 * Its own page is kept when it has at least this much text; anything less is a
 * teaser or an index page.
 */
export const MIN_ARTICLE_TEXT_CHARS = 1500;

export function isSubstantialPaperText(text: string, minChars: number = MIN_PAPER_TEXT_CHARS): boolean {
  return text.replace(/\s+/g, " ").trim().length >= minChars;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The frame's own policy, on top of the page's: images from https and inline
 * data only, the reader's inline stylesheet, nothing else — no scripts, no
 * fetches, no fonts, no frames. The iframe's `sandbox` already stops scripts;
 * this is the second lock on the same door.
 */
export const PAPER_HTML_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; media-src https:";

/** Readable defaults that follow the app's light or dark scheme. */
const READER_CSS = `
:root { color-scheme: light dark; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: 24px 20px 64px; font: 16px/1.6 Georgia, "Times New Roman", serif; color: CanvasText; background: Canvas; }
.wf-paper { max-width: 46rem; margin: 0 auto; overflow-wrap: anywhere; }
.wf-source { max-width: 46rem; margin: 0 auto 16px; font: 12px/1.4 system-ui, sans-serif; opacity: .7; }
h1, h2, h3, h4 { line-height: 1.25; font-family: system-ui, sans-serif; }
img, svg, video { max-width: 100%; height: auto; }
figure { margin: 1.5em 0; }
figcaption { font-size: .9em; opacity: .85; }
table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; font-size: .9em; }
td, th { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); padding: 4px 8px; }
pre, code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
pre { overflow-x: auto; }
math { font-size: 1.05em; }
a { color: LinkText; }
@media (max-width: 600px) { body { padding: 16px 16px 48px; font-size: 15px; } }
`;

const ARTICLE_OPEN = '<article class="wf-paper">';
const ARTICLE_CLOSE = "</article><!--/wf-paper-->";

/**
 * The document the frame is given, which is also the file kept in the folder:
 * it opens on its own in any browser, already sanitised, with where it came
 * from written into it.
 */
export function buildPaperHtmlDocument(
  page: PaperHtmlPage,
  /** Pin the frame to the app's scheme; the kept file follows the system's. */
  options: { scheme?: "light" | "dark" } = {},
): string {
  const host = (() => {
    try {
      return new URL(page.url).hostname;
    } catch {
      return page.url;
    }
  })();
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PAPER_HTML_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<meta name="weaveforge-source" content="${escapeAttr(page.url)}">`,
    `<meta name="weaveforge-saved" content="${escapeAttr(page.savedAt)}">`,
    `<title>${escapeText(page.title)}</title>`,
    `<style>${READER_CSS}${options.scheme ? `:root { color-scheme: ${options.scheme}; }` : ""}</style>`,
    "</head><body>",
    `<p class="wf-source">Full text from <a href="${escapeAttr(page.url)}" target="_blank" rel="noopener noreferrer">${escapeText(host)}</a></p>`,
    ARTICLE_OPEN,
    page.html,
    ARTICLE_CLOSE,
    "</body></html>",
  ].join("\n");
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Read a kept file back. `null` for anything this app did not write — a file
 * the person dropped into the folder by hand is not trusted as sanitised.
 */
export function parsePaperHtmlDocument(paperId: string, text: string): PaperHtmlPage | null {
  const start = text.indexOf(ARTICLE_OPEN);
  const end = text.lastIndexOf(ARTICLE_CLOSE);
  if (start < 0 || end < start) return null;
  const url = /<meta name="weaveforge-source" content="([^"]*)">/.exec(text)?.[1];
  if (!url) return null;
  const savedAt = /<meta name="weaveforge-saved" content="([^"]*)">/.exec(text)?.[1] ?? "";
  const title = /<title>([\s\S]*?)<\/title>/.exec(text)?.[1] ?? "";
  return {
    paperId,
    url: unescapeAttr(url),
    savedAt: unescapeAttr(savedAt),
    title: unescapeAttr(title),
    html: text.slice(start + ARTICLE_OPEN.length, end).replace(/^\n/, "").replace(/\n$/, ""),
  };
}
