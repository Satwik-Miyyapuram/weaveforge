/**
 * Blob store relay, served from the `app://` origin.
 *
 * The web app keeps its storage keys on the server and talks to it through
 * `/api/blobs/*` routes (`HttpBlobStore`). The static bundle the shell serves
 * has no server, so every one of those calls came back a 404: a picture put on
 * a paper or a note never uploaded, and none were shown. The shell relays them
 * to the hosted app, where the routes live.
 *
 * Only the blob routes travel, only GET and POST, and only the headers the
 * store sets (`authorization`, `content-type`). The upload's multipart body is
 * passed through as bytes so its boundary still matches the header.
 */

import { refuse, upstreamFailed, type ProxyFetch } from "./proxy-shared";

export const BLOB_PROXY_PREFIX = "/api/blobs/";
export const BLOB_UPSTREAM = "https://app.weaveforge.org";

export function isBlobProxyRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname.startsWith(BLOB_PROXY_PREFIX);
}

export async function proxyBlob(request: Request, fetchFn: ProxyFetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return refuse(405, "Method not allowed");
  const rest = url.pathname.slice(BLOB_PROXY_PREFIX.length);
  if (!rest || rest.includes("..") || rest.includes("//")) return refuse(400, "Bad blob path");

  return relayToHostedApp(request, `${BLOB_PROXY_PREFIX}${rest}${url.search}`, fetchFn);
}

/**
 * Sends one `app://` request on to the same path on the hosted app.
 *
 * Only `authorization` and `content-type` travel, the body goes as bytes, and
 * a dead network answers 502 rather than throwing into the protocol handler.
 * The caller decides which paths and methods may go.
 */
export async function relayToHostedApp(request: Request, pathAndQuery: string, fetchFn: ProxyFetch = fetch): Promise<Response> {
  const method = request.method.toUpperCase();
  const headers: Record<string, string> = {};
  const auth = request.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const type = request.headers.get("content-type");
  if (type) headers["content-type"] = type;
  const body = method === "POST" ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetchFn(`${BLOB_UPSTREAM}${pathAndQuery}`, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    return upstreamFailed("blob", error, 502, "Upstream fetch failed");
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    },
  });
}
