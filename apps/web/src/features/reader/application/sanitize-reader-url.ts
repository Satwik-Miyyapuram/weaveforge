/**
 * URL allowlists for the read-only reader. Query params and AI evidence hrefs
 * are untrusted — never put them in `<a href>` or pdf.js without checking.
 */

/**
 * Hosts the same-origin PDF proxy will fetch. Shared by the web route
 * (`app/api/pdf-proxy`) and the desktop shell (`apps/desktop/src/pdf-proxy.ts`),
 * which imports this helper — so there is one list, not three that drift.
 *
 * ## What belongs here
 *
 * Hosts that serve a PDF **without credentials**. The proxy fetches as an
 * anonymous client, so a paywalled host can be on this list and still fail with
 * a 403 — which is exactly what `journals.sagepub.com` and
 * `pdf.sciencedirectassets.com` did for the reader's library. Adding them would
 * be a line of code that changes nothing and reads as though it had.
 *
 * So this is the open-access half:
 *
 * - **Preprint and repository servers** — arXiv, OpenReview, the bioRxiv/medRxiv
 *   pair, ChemRxiv, and PubMed Central. All anonymous, all freely readable.
 * - **Open-access publishers** — PLOS, eLife, Frontiers, MDPI, Copernicus, and
 *   the Open Library of Humanities. Their entire output is open by licence.
 * - **A publisher's dedicated open-access infrastructure**, where one exists:
 *   `link.springer.com` (Springer's OA articles live on the same host and are
 *   served without credentials) and `springeropen.com`.
 *
 * **Big publishers are deliberately absent.** `www.nature.com` and
 * `onlinelibrary.wiley.com` are mostly paywalled, so listing them would promise
 * access this proxy cannot deliver for the papers the reader actually has — the
 * same mistake as listing SAGE or Elsevier, which is what this list exists to
 * avoid. If a paper of yours is open access on one of those hosts and does not
 * index, that is the case to add, individually, rather than the whole domain.
 *
 * A host is a *domain*, not a prefix of one: `isAllowedPdfProxyUrl` compares
 * `hostname` exactly against this set, so `evil-arxiv.org` cannot pass and a
 * lookalike subdomain must be named here to be reachable.
 */
const PDF_PROXY_ALLOWED_HOSTS = new Set([
  // Preprints and repositories.
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "openreview.net",
  "www.openreview.net",
  "biorxiv.org",
  "www.biorxiv.org",
  "medrxiv.org",
  "www.medrxiv.org",
  "chemrxiv.org",
  "www.chemrxiv.org",
  "ncbi.nlm.nih.gov",
  "www.ncbi.nlm.nih.gov",
  "pmc.ncbi.nlm.nih.gov",
  "europepmc.org",
  "www.europepmc.org",
  "hal.science",
  "hal.archives-ouvertes.fr",
  "zenodo.org",
  // Open-access publishers.
  "journals.plos.org",
  "plos.org",
  "www.plos.org",
  "elifesciences.org",
  "www.elifesciences.org",
  "frontiersin.org",
  "www.frontiersin.org",
  "mdpi.com",
  "www.mdpi.com",
  "copernicus.org",
  "www.copernicus.org",
  "olh.openlibhums.org",
  "openlibhums.org",
  "springeropen.com",
  "www.springeropen.com",
  "link.springer.com",
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
 * True for an object URL this page minted (`blob:<origin>/<uuid>`).
 *
 * The reader's source ladder caches PDF bytes in IndexedDB and materialises
 * them through `URL.createObjectURL`, so the second open of any paper hands
 * pdf.js a `blob:` URL rather than an https one. Those are same-origin handles
 * to bytes already in this tab — there is no network fetch and no host to
 * allowlist — but they are not `https:`, so the plain PDF-URL check rejected
 * them and the reader refused to open a paper it had itself cached.
 *
 * Deliberately narrower than "starts with blob:": a blob URL carries the origin
 * that created it, and only our own is accepted.
 */
export function isReaderObjectUrl(raw: string | null | undefined): boolean {
  if (!raw || !raw.startsWith("blob:")) return false;
  if (typeof location === "undefined") return false;
  try {
    return new URL(raw.slice("blob:".length)).origin === location.origin;
  } catch {
    return false;
  }
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
  // Block whitespace, backslash, and path traversal before the allowlist runs.
  if (/[\s\\]/.test(trimmed) || trimmed.includes("..")) return null;
  if (
    !/^\/(reader|papers|notes|report|log|vault|lists|graph|experiments|plan|ai-review|dashboard|settings|org|git|link)(\/[^?]*)?(\?.*)?$/.test(
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
  /**
   * The open-access copy a metadata source reported (Semantic Scholar's
   * `openAccessPdf`). A paper added from a reference list often has only a
   * DOI and a landing page; this is the one direct PDF link it carries.
   */
  openAccessPdf?: string | null;
}): string | null {
  void input.pdfPath;
  const fromArxivId = input.arxivId?.trim();
  if (fromArxivId) {
    const id = fromArxivId.replace(/^arxiv:/i, "");
    return sanitizePdfUrl(`https://arxiv.org/pdf/${id}`);
  }
  return pdfUrlFromLink(input.openAccessPdf) ?? pdfUrlFromLink(input.url);
}

/** A stored link as a PDF URL pdf.js may open, or null for a landing page. */
function pdfUrlFromLink(link: string | null | undefined): string | null {
  const raw = link?.trim();
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
