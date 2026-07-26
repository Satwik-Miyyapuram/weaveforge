/**
 * URL allowlists for the read-only reader. Query params and AI evidence hrefs
 * are untrusted — never put them in `<a href>` or pdf.js without checking.
 */

/** Hosts the same-origin PDF proxy will fetch (must stay in sync with the route). */
export const PDF_PROXY_ALLOWED_HOSTS = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "openreview.net",
  "www.openreview.net",
]);

/** Hard stream cap for proxied PDFs (also enforced when Content-Length is absent). */
export const PDF_PROXY_MAX_BYTES = 80 * 1024 * 1024; // 80 MiB

/** True when `raw` is an https URL on {@link PDF_PROXY_ALLOWED_HOSTS} with no credentials. */
export function isAllowedPdfProxyUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return PDF_PROXY_ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

/** Accept only https PDF URLs for pdf.js / "open original" links. */
export function sanitizePdfUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // Reject credentials-in-URL (phishing / exfil lookalikes).
  if (url.username || url.password) return null;
  return url.toString();
}

/**
 * Only same-origin `/reader…` paths may be used as evidence deep links into the
 * PDF reader. Rebuild via {@link buildLocusLink} when the stored href is untrusted.
 */
export function sanitizeReaderHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/reader")) return null;
  // Block protocol-relative and scheme smuggling (`/reader@evil`, `/reader\n…`).
  if (/[\s\\]/.test(trimmed)) return null;
  if (trimmed === "/reader" || trimmed.startsWith("/reader?")) return trimmed;
  return null;
}

/**
 * Same-origin app paths safe to render as evidence "Open source" links
 * (`/papers`, `/notes`, `/reader`, …). Rejects scheme smuggling and unknown roots.
 */
export function sanitizeAppHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (/[\s\\]/.test(trimmed)) return null;
  if (
    !/^\/(reader|papers|notes|report|log|vault|lists|graph|experiments|plan|ai-review|dashboard|settings|org|git|link)(\/|\?|$)/.test(
      trimmed,
    )
  ) {
    return null;
  }
  return trimmed;
}

/** True when a URL pathname looks like a direct PDF resource, not an HTML landing page. */
export function looksLikePdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (/\.html?$/i.test(path)) return false;
    if (/\.pdf$/i.test(path)) return true;
    // Trailing `/pdf` or `/pdf/` (OpenReview)
    if (/(^|\/)pdf\/?$/i.test(path)) return true;
    // `/pdf/<id>` OA hosts and DOI-style `/doi/pdf/10.…`
    if (/\/pdf\//i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Rewrite an allowlisted remote PDF URL through the same-origin proxy so pdf.js
 * does not hit CORS. Unknown hosts are returned unchanged (caller may still fail).
 */
export function proxiedPdfUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!isAllowedPdfProxyUrl(u.toString())) return url;
    return `/api/pdf-proxy?url=${encodeURIComponent(u.toString())}`;
  } catch {
    return url;
  }
}

/** Recover the original https PDF URL from a same-origin proxy path, if present. */
export function originalUrlFromProxy(url: string): string | null {
  if (!url.startsWith("/api/pdf-proxy?")) return null;
  try {
    const target = new URL(url, "https://local.invalid").searchParams.get("url");
    return sanitizePdfUrl(target);
  } catch {
    return null;
  }
}

/**
 * Best-effort map from a paper landing URL / arXiv id to a PDF URL the reader
 * can open. Returns null when we cannot derive a PDF (caller surfaces an error).
 * `pdfPath` is reserved for a future signed-blob ladder and is ignored today.
 */
export function resolvePaperPdfUrl(input: {
  url?: string | null;
  arxivId?: string | null;
  /** @deprecated Ignored until storage-backed PDFs are wired; kept for call-site stability. */
  pdfPath?: string | null;
}): string | null {
  void input.pdfPath;
  const fromArxivId = input.arxivId?.trim();
  if (fromArxivId) {
    const id = fromArxivId.replace(/^arxiv:/i, "");
    return sanitizePdfUrl(`https://arxiv.org/pdf/${id}`);
  }
  const raw = input.url?.trim();
  if (!raw) return null;
  // arXiv abs → pdf
  const abs = /^https?:\/\/(?:www\.)?arxiv\.org\/abs\/([^?#\s]+)/i.exec(raw);
  if (abs) return sanitizePdfUrl(`https://arxiv.org/pdf/${abs[1]}`);
  // Already a pdf path on arxiv
  const pdf = /^https?:\/\/(?:www\.)?arxiv\.org\/pdf\/([^?#\s]+)/i.exec(raw);
  if (pdf) return sanitizePdfUrl(`https://arxiv.org/pdf/${pdf[1]}`);
  const sanitized = sanitizePdfUrl(raw);
  if (!sanitized) return null;
  if (looksLikePdfUrl(sanitized)) return sanitized;
  // Unknown HTML landing page — do not hand to pdf.js.
  return null;
}
