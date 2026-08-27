/**
 * Reading the Zotero running on this machine.
 *
 * Zotero 7 answers a read-only copy of the Web API on loopback, at
 * `http://127.0.0.1:23119/api`, with no key and no account. That is the whole
 * feature: the same JSON the cloud API returns, for a library that never left
 * the desk. Everything above this file — pagination, the annotation parser,
 * the join from attachment to paper — is the existing Web API code, pointed at
 * a different origin.
 *
 * The page cannot make that request itself. It is served over `app://` or
 * `https://`, and a plain-HTTP loopback request from either is blocked as
 * mixed content before CORS is even consulted. So the shell makes it.
 *
 * Which is exactly why this is a proxy with one destination and not a fetch.
 * A channel that took any URL would be an open request-forwarder sitting
 * inside the renderer's reach, useful for reaching anything the machine can
 * reach and nothing else. The guard below is the point of the file.
 */

const LOCAL_ORIGIN = "http://127.0.0.1:23119";

/** The library root to hand `zoteroLibraryUrl`. Local Zotero is always user 0. */
export const ZOTERO_LOCAL_API = `${LOCAL_ORIGIN}/api`;
export const ZOTERO_LOCAL_LIBRARY = "users/0";

/** Long enough for a big library page, short enough that a wedge is not forever. */
const TIMEOUT_MS = 20_000;

/** Response headers the pager reads. Nothing else crosses. */
const KEEP_HEADERS = ["total-results", "backoff", "retry-after", "content-type"];

export interface ZoteroLocalReply {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/** True only for a GET against the local Zotero API's own path. */
export function isLocalZoteroUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.origin === LOCAL_ORIGIN &&
    (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) &&
    !parsed.username &&
    !parsed.password
  );
}

export async function fetchZoteroLocal(
  url: unknown,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<ZoteroLocalReply> {
  if (typeof url !== "string" || !isLocalZoteroUrl(url)) {
    throw new Error("Only the Zotero API on this computer can be read here.");
  }
  const res = await fetchFn(url, {
    // No credentials, no redirects: a redirect is how a loopback read would
    // become a read of somewhere else.
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Zotero-API-Version": "3" },
  });
  const headers: Record<string, string> = {};
  for (const name of KEEP_HEADERS) {
    const value = res.headers.get(name);
    if (value) headers[name] = value;
  }
  return { status: res.status, body: await res.text(), headers };
}
