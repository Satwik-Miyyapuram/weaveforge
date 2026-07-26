/**
 * URL allowlists for the read-only reader. Query params and AI evidence hrefs
 * are untrusted — never put them in `<a href>` or pdf.js without checking.
 */

/** Accept only http(s) PDF URLs for pdf.js / "open original" links. */
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
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // Reject credentials-in-URL (phishing / exfil lookalikes).
  if (url.username || url.password) return null;
  return url.toString();
}

/**
 * Only same-origin `/reader…` paths may be used as evidence deep links.
 * Rebuild via {@link buildLocusLink} when the stored href is untrusted.
 */
export function sanitizeReaderHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/reader")) return null;
  // Block protocol-relative and scheme smuggling (`/reader@evil`, `/reader\n…`).
  if (/[\s\\]/.test(trimmed)) return null;
  if (trimmed.length > 1 && trimmed[1] !== "?" && trimmed[1] !== "/" && trimmed !== "/reader") {
    // Allow `/reader` or `/reader?...` only (no `/reader-evil`).
    if (!trimmed.startsWith("/reader?")) return null;
  }
  return trimmed;
}

/** True when a URL pathname looks like a direct PDF resource, not an HTML landing page. */
export function looksLikePdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (/\.pdf$/i.test(path)) return true;
    // Trailing `/pdf` or `/pdf/` (OpenReview, some OA hosts) — not `/blog/pdf/guide`.
    if (/(^|\/)pdf\/?$/i.test(path)) return true;
    // DOI-style OA: `/doi/pdf/10.…`
    if (/\/doi\/pdf\//i.test(path)) return true;
    return false;
  } catch {
    return false;
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
