/**
 * The browser's wiring for "Find a free copy": the network, the stores and the
 * sanitiser behind the ports `find-free-copy.ts` takes.
 *
 * The indexes are asked directly — every one of them sends CORS headers. The
 * copies they list are fetched the way a typed address is: PDFs through
 * `fetchTypedPdfToCache` (the shell's relay on desktop, the proxy or a direct
 * CORS fetch on the web), pages through the HTML relay.
 */

import { findOpenAccessCopies, type OpenAccessHttp, type OpenAccessIds } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { pdfProxyNeedsToken } from "./pdf-download-consent";
import { fetchTypedPdfToCache } from "./resolve-paper-pdf-for-reader";
import { HTML_FINAL_URL_HEADER, HTML_PROXY_PATH } from "./paper-html-rules";
import { findFreeCopy, type FreeCopyOutcome, type HtmlFetchResult } from "./find-free-copy";

const INDEX_TIMEOUT_MS = 12_000;

/** JSON from an index: `null` for "not here" (404), a throw for "could not ask". */
export function openAccessHttp(fetchFn: typeof fetch = fetch): OpenAccessHttp {
  return async (url) => {
    const res = await fetchFn(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return res.json();
  };
}

/**
 * Fetch a paper's web page as text.
 *
 * Always through a relay, because a blog or a journal page almost never sends
 * CORS headers. Desktop: the shell's relay, any https host. Web: the server's
 * relay, which fetches the open-access hosts it knows directly and any other
 * page through its address-guarded fetch, within a per-user budget.
 */
export async function fetchPaperHtml(
  url: string,
  fetchFn: typeof fetch = fetch,
  getAccessToken: () => Promise<string | null> = () => getContainer().auth.auth.getAccessToken(),
): Promise<HtmlFetchResult> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (desktop() === null && pdfProxyNeedsToken()) {
      const token = await getAccessToken();
      if (!token) return { ok: false, reason: "failed" };
      headers.Authorization = `Bearer ${token}`;
    }
    res = await fetchFn(`${HTML_PROXY_PATH}?url=${encodeURIComponent(url)}`, { headers });
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (!res.ok) {
    if (res.status === 415) return { ok: false, reason: "not-html", status: res.status };
    // The site itself said no (403), or its address is one the relay will not
    // dial (400): the page is there, just not to us.
    return { ok: false, reason: res.status === 403 || res.status === 400 ? "blocked" : "failed", status: res.status };
  }
  const raw = await res.text();
  const finalUrl = res.headers.get(HTML_FINAL_URL_HEADER) || url;
  return { ok: true, raw, finalUrl };
}

/** Run the search for one paper with the real network and stores. */
export async function findFreeCopyInBrowser(paperId: string, ids: OpenAccessIds): Promise<FreeCopyOutcome> {
  const [{ sanitizePaperHtml }, { paperHtmlStore }] = await Promise.all([
    import("../infrastructure/sanitize-paper-html"),
    import("../infrastructure/paper-html-store"),
  ]);
  return findFreeCopy(paperId, ids, {
    lookup: (lookupIds) =>
      findOpenAccessCopies(lookupIds, {
        http: openAccessHttp(),
        unpaywallEmail: process.env.NEXT_PUBLIC_UNPAYWALL_EMAIL,
      }),
    fetchPdf: (id, url) => fetchTypedPdfToCache(id, url),
    fetchHtml: (url) => fetchPaperHtml(url),
    sanitize: sanitizePaperHtml,
    saveHtml: async (page) => {
      const store = paperHtmlStore();
      if (!store) throw new Error("No store for web pages");
      await store.set(page);
    },
  });
}
