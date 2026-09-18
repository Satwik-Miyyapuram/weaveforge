/**
 * Semantic Scholar relay, served from the `app://` origin.
 *
 * The API does send `access-control-allow-origin: *` on a good answer, but
 * not on a 429 — and it rate-limits hard. In a page that means the renderer
 * sees a bare "Failed to fetch" for a throttled call, cannot tell it from a
 * dead network, and cannot retry the way the web app's fetch policy does.
 * The shell answers `/api/semantic-scholar/<path>` itself with `net.fetch`,
 * where no CORS applies: the real status comes back, and a 429 is retried
 * here before the renderer hears about it.
 *
 * Only `api.semanticscholar.org` is reachable, only GET and POST are
 * forwarded, and only the headers the sources set (`x-api-key`,
 * `content-type`) travel upstream.
 */

export const SEMANTIC_SCHOLAR_PROXY_PREFIX = "/api/semantic-scholar/";
const UPSTREAM = "https://api.semanticscholar.org";
const RETRIES = 3;

export function isSemanticScholarProxyRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname.startsWith(SEMANTIC_SCHOLAR_PROXY_PREFIX);
}

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type ProxyFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function proxySemanticScholar(
  request: Request,
  fetchFn: ProxyFetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return refuse(405, "Method not allowed");
  const rest = url.pathname.slice(SEMANTIC_SCHOLAR_PROXY_PREFIX.length);
  if (!rest || rest.includes("..")) return refuse(400, "Bad Semantic Scholar path");
  const target = `${UPSTREAM}/${rest}${url.search}`;

  const headers: Record<string, string> = { accept: "application/json" };
  const key = request.headers.get("x-api-key");
  if (key) headers["x-api-key"] = key;
  const type = request.headers.get("content-type");
  if (type) headers["content-type"] = type;
  const body = method === "POST" ? await request.text() : undefined;

  const send = () =>
    fetchFn(target, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

  let upstream: Response;
  try {
    upstream = await send();
    for (let attempt = 0; upstream.status === 429 && attempt < RETRIES; attempt++) {
      await wait(1000 * (attempt + 1));
      upstream = await send();
    }
  } catch {
    return refuse(502, "Upstream fetch failed");
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-content-type-options": "nosniff",
    },
  });
}
