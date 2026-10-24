import {
  isAllowedPdfProxyUrl,
  PDF_PROXY_MAX_BYTES,
} from "@/features/reader/application/sanitize-reader-url";
import { hasPdfMagic, isPdfContentType } from "@/features/reader/application/pdf-response-rules";
import { readCapped } from "@/lib/read-capped";
import { fetchCheckedHops, isPublicHttpsUrl, refuse, type ProxyFetch } from "./proxy-shared";

/**
 * The reader's PDF proxy, served from the `app://` origin.
 *
 * The web app fetches a publisher's PDF on its server because arXiv and
 * OpenReview send no CORS headers, so pdf.js cannot read them from a page.
 * The bundled app has no server, and its pages are on `app://`, which those
 * hosts refuse just the same — so the shell answers the same path itself.
 * Same allowlist, same checks as `api/pdf-proxy/_proxy.ts` (https only,
 * the host re-checked after redirects, PDF magic, a byte cap); without the
 * bearer token, because there is no account here to hold one. The renderer
 * knows that: see `fetchPdfBytesForCache`.
 *
 * One thing the server's copy does not do: with `typed=1`, a URL the reader
 * typed themselves may be on any https host. The allowlist on the server
 * keeps it from being a fetch-anything relay for the whole internet; here the
 * only person it can fetch for is the one at the keyboard, who could open
 * the same address in a browser. The PDF check and the byte cap still hold,
 * and so does https, so a typed address cannot reach `http://localhost`;
 * nor can it name a loopback, private or link-local host over https, at the
 * start or on any hop of a redirect (a name that *resolves* to one is not
 * caught here — that would take a resolver the shell does not have).
 *
 * Redirects are followed one hop at a time so each address is checked before
 * it is fetched, not only the one the chain ended on.
 *
 * `fetchFn` is injected so the shaping can be tested without a network.
 */

export const PDF_PROXY_PATH = "/api/pdf-proxy";

export function isPdfProxyRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname === PDF_PROXY_PATH;
}

export async function proxyPdf(
  requestUrl: string,
  fetchFn: ProxyFetch = fetch,
): Promise<Response> {
  const params = new URL(requestUrl).searchParams;
  const target = params.get("url");
  if (!target) return refuse(400, "url is required");
  const typed = params.get("typed") === "1";
  const allowed = typed ? isPublicHttpsUrl : isAllowedPdfProxyUrl;
  if (!allowed(target)) return refuse(400, "URL host is not allowed for PDF proxy");

  const fetched = await fetchCheckedHops(
    target,
    allowed,
    fetchFn,
    { headers: { accept: "application/pdf", "user-agent": "WeaveForge desktop" }, signal: AbortSignal.timeout(90_000) },
    // The allowlist's hosts are trusted to redirect within reason, so an
    // opaque redirect gets one followed fetch; a typed address does not.
    !typed,
  );
  if (!fetched.ok) return fetched.refusal;
  const upstream = fetched.response;
  if (!upstream.ok) return refuse(502, `Upstream returned ${upstream.status}`);
  if (!isPdfContentType(upstream.headers.get("content-type"))) {
    return refuse(415, "Upstream did not return a PDF");
  }
  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared > PDF_PROXY_MAX_BYTES) return refuse(413, "PDF too large");

  // The cap holds while reading: a missing or wrong content-length must not
  // let a stream fill memory before the size is known.
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    bytes = await readCapped(upstream.body, PDF_PROXY_MAX_BYTES);
  } catch {
    return refuse(504, "Upstream body did not arrive in time");
  }
  if (!bytes) return refuse(413, "PDF too large");
  if (!hasPdfMagic(bytes)) return refuse(415, "Upstream did not return a PDF");

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(bytes.byteLength),
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
