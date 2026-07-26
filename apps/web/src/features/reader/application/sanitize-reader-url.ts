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

/**
 * Best-effort map from a paper landing URL / arXiv id to a PDF URL the reader
 * can open. Returns null when we cannot derive a PDF (caller surfaces an error).
 */
export function resolvePaperPdfUrl(input: {
  url?: string | null;
  arxivId?: string | null;
  pdfPath?: string | null;
}): string | null {
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
  // Generic: accept only when the path looks like a PDF (or ends with .pdf).
  const sanitized = sanitizePdfUrl(raw);
  if (!sanitized) return null;
  try {
    const u = new URL(sanitized);
    if (/\.pdf($|\?)/i.test(u.pathname) || u.pathname.includes("/pdf/")) return sanitized;
  } catch {
    return null;
  }
  // Unknown HTML landing page — do not hand to pdf.js.
  return null;
}
