import { NextResponse } from "next/server";
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from "@/backend/net/safe-fetch";
import { isAllowedPdfProxyUrl } from "@/features/reader/application/sanitize-reader-url";
import {
  decodeHtmlBytes,
  HTML_PROXY_MAX_BYTES,
  htmlRelayResponse,
  isHtmlContentType,
  readCapped,
} from "@/features/reader/application/paper-html-rules";

/**
 * The web server's HTML relay for papers published as web pages.
 *
 * Same hosts as the PDF proxy — the open-access repositories and publishers —
 * and the same guards: https only, each redirect hop re-checked against the
 * list, a byte cap enforced while reading, and one deadline over the whole
 * exchange so a host that trickles cannot hold a server slot open. The page
 * goes back as text; the reader sanitises it before anything is shown.
 *
 * Papers that are blog posts or essays live on no list, so `proxyAnyHtml`
 * takes any http(s) host instead — through `safeFetch`, which refuses private
 * and link-local addresses at every hop, with the same cap and deadline.
 *
 * `fetchFn` and the deadline are injectable so the rules can be tested without
 * a network.
 */

const MAX_REDIRECTS = 5;
const DEADLINE_MS = 45_000;

export interface HtmlProxyOptions {
  fetchFn?: typeof fetch;
  deadlineMs?: number;
}

function refuse(status: number, error: string): Response {
  return NextResponse.json({ error }, { status });
}

export async function proxyAllowlistedHtml(startUrl: string, options: HtmlProxyOptions = {}): Promise<Response> {
  const fetchFn = options.fetchFn ?? fetch;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.deadlineMs ?? DEADLINE_MS);
  try {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedPdfProxyUrl(current)) return refuse(400, "URL host is not allowed for the HTML proxy");
      let upstream: Response;
      try {
        upstream = await fetchFn(current, {
          redirect: "manual",
          cache: "no-store",
          signal: abort.signal,
          headers: {
            "User-Agent": "weaveforge-reader/1.0 (mailto:noreply@example.com)",
            Accept: "text/html,application/xhtml+xml",
          },
        });
      } catch {
        return refuse(abort.signal.aborted ? 504 : 502, abort.signal.aborted ? "Upstream timed out" : "Upstream fetch failed");
      }
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get("location");
        void upstream.body?.cancel().catch(() => undefined);
        if (!location) return refuse(400, "Redirect missing Location");
        try {
          current = new URL(location, current).toString();
        } catch {
          return refuse(400, "Redirect Location is invalid");
        }
        continue;
      }
      if (!upstream.ok || !upstream.body) {
        void upstream.body?.cancel().catch(() => undefined);
        return refuse(502, `Upstream returned ${upstream.status}`);
      }
      const type = upstream.headers.get("content-type");
      if (!isHtmlContentType(type)) {
        void upstream.body.cancel().catch(() => undefined);
        return refuse(415, "Upstream did not return a web page");
      }
      if (Number(upstream.headers.get("content-length") ?? "0") > HTML_PROXY_MAX_BYTES) {
        void upstream.body.cancel().catch(() => undefined);
        return refuse(413, "Page too large");
      }
      let bytes: Uint8Array | null;
      try {
        bytes = await readCapped(upstream.body, HTML_PROXY_MAX_BYTES);
      } catch {
        return refuse(504, "Upstream body did not arrive in time");
      }
      if (!bytes) return refuse(413, "Page too large");
      return htmlRelayResponse(decodeHtmlBytes(bytes, type), current);
    }
    return refuse(400, "Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Any other https or http page: a research blog post, an essay, a lab's
 * write-up — papers that are web pages and live on no list.
 *
 * Not the allowlisted path with the list switched off. This goes through
 * `safeFetch`, which resolves each host, refuses private and link-local
 * addresses, dials the address it checked and re-checks every redirect hop —
 * the guard `url-meta` already relies on for exactly this kind of fetch.
 * The route rate-limits it per user on top.
 */
export async function proxyAnyHtml(
  target: string,
  fetchPage: (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult> = safeFetch,
): Promise<Response> {
  const result = await fetchPage(target, {
    accept: "text/html,application/xhtml+xml",
    maxBytes: HTML_PROXY_MAX_BYTES,
    timeoutMs: DEADLINE_MS,
  });
  if (!result.ok) return refuse(result.status, result.message);
  if (!isHtmlContentType(result.contentType)) return refuse(415, "Upstream did not return a web page");
  return htmlRelayResponse(decodeHtmlBytes(result.body, result.contentType), result.url);
}
