import {
  decodeHtmlBytes,
  HTML_PROXY_MAX_BYTES,
  HTML_PROXY_PATH,
  htmlRelayResponse,
  isHtmlContentType,
  readCapped,
} from "@/features/reader/application/paper-html-rules";

/**
 * The reader's HTML relay, served from the `app://` origin.
 *
 * Fetches a paper's full-text web page — arXiv's HTML, PubMed Central, a
 * journal's article view — for the reader, which cannot fetch it itself
 * because those hosts send no CORS headers. Any https host, as with a typed
 * PDF address (see `pdf-proxy.ts`): the only person it fetches for is the one
 * at the keyboard, the addresses come from the open-access indexes they asked,
 * and https keeps it off `http://localhost`.
 *
 * The page comes back as text with the address it ended at; the renderer
 * sanitises it before anything is shown. `fetchFn` is injected for tests.
 */

export function isHtmlProxyRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname === HTML_PROXY_PATH;
}

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export type HtmlFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function proxyHtml(requestUrl: string, fetchFn: HtmlFetch = fetch): Promise<Response> {
  const target = new URL(requestUrl).searchParams.get("url");
  if (!target) return refuse(400, "url is required");
  if (!isHttpsUrl(target)) return refuse(400, "Only https addresses can be fetched");

  let upstream: Response;
  try {
    upstream = await fetchFn(target, {
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "WeaveForge desktop" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return refuse(502, "Upstream fetch failed");
  }
  const finalUrl = upstream.url || target;
  if (!isHttpsUrl(finalUrl)) return refuse(400, "Redirect target not allowed");
  if (!upstream.ok) return refuse(502, `Upstream returned ${upstream.status}`);
  const type = upstream.headers.get("content-type");
  if (!isHtmlContentType(type)) return refuse(415, "Upstream did not return a web page");
  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared > HTML_PROXY_MAX_BYTES) return refuse(413, "Page too large");

  if (!upstream.body) return refuse(502, "Upstream sent no body");
  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(upstream.body, HTML_PROXY_MAX_BYTES);
  } catch {
    return refuse(504, "Upstream body did not arrive in time");
  }
  if (!bytes) return refuse(413, "Page too large");
  return htmlRelayResponse(decodeHtmlBytes(bytes, type), finalUrl);
}
