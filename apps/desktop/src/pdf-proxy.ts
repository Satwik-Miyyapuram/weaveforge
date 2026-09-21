import {
  isAllowedPdfProxyUrl,
  PDF_PROXY_MAX_BYTES,
} from "@/features/reader/application/sanitize-reader-url";

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
 * and so does https, so a typed address cannot reach `http://localhost`.
 *
 * `fetchFn` is injected so the shaping can be tested without a network.
 */

export const PDF_PROXY_PATH = "/api/pdf-proxy";

const PDF_MAGIC_WINDOW = 1024;

export function isPdfProxyRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname === PDF_PROXY_PATH;
}

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isPdfContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/pdf" || type === "application/octet-stream";
}

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, PDF_MAGIC_WINDOW));
  return head.includes("%PDF");
}

/** An https address without credentials — what a typed URL must be. */
function isHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export type PdfFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function proxyPdf(
  requestUrl: string,
  fetchFn: PdfFetch = fetch,
): Promise<Response> {
  const params = new URL(requestUrl).searchParams;
  const target = params.get("url");
  if (!target) return refuse(400, "url is required");
  const typed = params.get("typed") === "1";
  const allowed = typed ? isHttpsUrl : isAllowedPdfProxyUrl;
  if (!allowed(target)) return refuse(400, "URL host is not allowed for PDF proxy");

  let upstream: Response;
  try {
    upstream = await fetchFn(target, {
      redirect: "follow",
      headers: { accept: "application/pdf", "user-agent": "WeaveForge desktop" },
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return refuse(502, "Upstream fetch failed");
  }
  // A redirect may have left the allowlist; the final address is what counts.
  if (upstream.url && !allowed(upstream.url)) {
    return refuse(400, "Redirect target not allowed");
  }
  if (!upstream.ok) return refuse(502, `Upstream returned ${upstream.status}`);
  if (!isPdfContentType(upstream.headers.get("content-type"))) {
    return refuse(415, "Upstream did not return a PDF");
  }
  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared > PDF_PROXY_MAX_BYTES) return refuse(413, "PDF too large");

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > PDF_PROXY_MAX_BYTES) return refuse(413, "PDF too large");
  if (!looksLikePdf(bytes)) return refuse(415, "Upstream did not return a PDF");

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
