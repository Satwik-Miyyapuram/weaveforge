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

/**
 * A host this machine or its network answers for: loopback, the private
 * ranges, link-local (which includes the cloud metadata address) and their
 * IPv6 counterparts. Literal addresses and `localhost` only.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  const tail = host.match(/^::ffff:(.+)$/)?.[1];
  if (tail) return tail.includes(".") ? isPrivateHost(tail) : true;
  return /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
}

/** An https address without credentials on a public host — what a typed URL must be. */
function isHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" && !url.username && !url.password && !isPrivateHost(url.hostname)
    );
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 5;

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

  const signal = AbortSignal.timeout(90_000);
  const headers = { accept: "application/pdf", "user-agent": "WeaveForge desktop" };
  let upstream: Response;
  let at = target;
  try {
    for (let hop = 0; ; hop++) {
      upstream = await fetchFn(at, { redirect: "manual", headers, signal });
      const next = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get("location") : null;
      if (next) {
        if (hop >= MAX_REDIRECTS) return refuse(502, "Too many redirects");
        at = new URL(next, at).toString();
        // Each hop is held to the same rule before it is fetched.
        if (!allowed(at)) return refuse(400, "Redirect target not allowed");
        continue;
      }
      if (upstream.type === "opaqueredirect") {
        // A fetch that will not show where it is redirecting. The allowlist's
        // hosts are trusted to redirect within reason, so they get one followed
        // fetch; a typed address does not.
        if (typed) return refuse(502, "Redirect could not be checked");
        upstream = await fetchFn(at, { redirect: "follow", headers, signal });
      }
      break;
    }
  } catch {
    return refuse(502, "Upstream fetch failed");
  }
  // The final address is checked too: a followed fetch may have moved.
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
