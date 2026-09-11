/**
 * Encoder weights, kept on the disk after the first download.
 *
 * The browser copy leaves the model in the HTTP cache, which is the browser's
 * to evict — turn semantic search on, clear site data, and the tens of
 * megabytes come down again. On a desktop copy that is worse than untidy: the
 * whole point of a copy with no account is that it works with the network
 * unplugged, and a model that has to be re-fetched makes that false.
 *
 * So `app://models/...` is served from a folder in the app's own data
 * directory, filled from the upstream host the first time each file is asked
 * for. After that the feature works offline, across restarts, for good.
 */

import { net } from "electron";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** The host the weights actually come from, when they are not here yet. */
const UPSTREAM = "https://huggingface.co";

/** The hostname the renderer points `env.remoteHost` at. */
export const MODEL_HOST = "models";

/** A model file is tens of megabytes; anything far past that is not one. */
const MAX_FILE_BYTES = 512 * 1024 * 1024;

/**
 * A cache path that stays inside the cache directory.
 *
 * The renderer composes these URLs, so the same rule as everywhere else
 * applies: traversal and absolute paths are refused rather than normalised.
 */
export function cachePathFor(root: string, url: string): string | null {
  const { pathname } = new URL(url);
  const parts = decodeURIComponent(pathname).split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes("\\"))) return null;
  return path.join(root, ...parts);
}

/**
 * How far a download may be led before it is given up on.
 *
 * Enough for the shapes this actually sees -- a redirect to a CDN host and, on
 * a bad day, one more -- and no more. What a redirect buys an attacker here is
 * not the file; it is the app making a request the caller chose to a host the
 * caller chose, from a process that sits inside the reader's machine. Bounded,
 * it is a cache miss that returns 502.
 */
const MAX_REDIRECTS = 3;

/** What a download needs of `fetch`, so a test can supply the responses. */
export type FetchLike = (url: string, init?: { redirect?: "manual" }) => Promise<Response>;

/**
 * Serve one model file, fetching it upstream if this is the first ask.
 *
 * A failed download is a 502 rather than a throw: the encoder reports it to
 * the page, which can say "the weights could not be fetched" instead of
 * failing silently with a model that never loads.
 *
 * Redirects are walked by hand rather than by `fetch`'s own following, for two
 * reasons: the limit has to be a number in this file rather than whatever the
 * ambient default happens to be, and a redirect chain that leaves the upstream
 * host is a chain this did not intend to walk. Every hop is checked, and the
 * first one outside the host answers 502 instead of being followed.
 */
export async function serveModelFile(
  root: string,
  url: string,
  fetchUpstream: FetchLike = net.fetch as unknown as FetchLike,
): Promise<Response> {
  const file = cachePathFor(root, url);
  if (!file) return new Response(null, { status: 404 });

  const cached = await readFile(file).catch(() => null);
  if (cached) return new Response(new Uint8Array(cached), { status: 200, headers: headersFor(file) });

  let target = `${UPSTREAM}${new URL(url).pathname}`;
  let upstream: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const answer = await fetchUpstream(target, { redirect: "manual" }).catch(() => null);
    if (!answer) return new Response(null, { status: 502 });
    const location = answer.headers.get("location");
    if (!answer.ok && location) {
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        return new Response(null, { status: 502 });
      }
      // Same host, or the download stops here. A redirect that changes host is
      // not something any of these files does, and the app will not be the
      // thing that follows one on somebody's behalf.
      if (next.host !== new URL(UPSTREAM).host) return new Response(null, { status: 502 });
      target = next.toString();
      continue;
    }
    upstream = answer;
    break;
  }
  if (!upstream) return new Response(null, { status: 502 });
  if (!upstream.ok) return new Response(null, { status: upstream.status });

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) return new Response(null, { status: 502 });

  // Written under a temporary name and renamed, so an interrupted download
  // never leaves a half file that later reads would trust.
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.part`;
  await writeFile(temporary, bytes);
  await rename(temporary, file).catch(() => {});

  return new Response(bytes, { status: 200, headers: headersFor(file) });
}

/**
 * The content type, and nothing else.
 *
 * No `access-control-allow-origin`. It was `*`, which invites any page in any
 * frame to read the encoder's weights and its config through this app -- a
 * cross-origin read of a resource that is otherwise only reachable from the
 * app's own origin. Nothing asks for it: the renderer fetches `app://models/...`
 * as a same-origin request, where CORS is not consulted at all, and the browser
 * build never touches this host.
 */
function headersFor(file: string): Record<string, string> {
  const type = file.endsWith(".json")
    ? "application/json"
    : file.endsWith(".onnx")
      ? "application/octet-stream"
      : "text/plain; charset=utf-8";
  return { "content-type": type };
}
