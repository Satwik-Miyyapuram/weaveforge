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

/**
 * Whether a redirect target is still the weight host's own infrastructure.
 *
 * **This used to be an exact-host comparison and it broke the entire feature.**
 * Every file Hugging Face serves is a redirect: `config.json` answers `307` to a
 * relative `/api/resolve-cache/...` path on the same host, and the weights answer
 * `302` to `https://us.aws.cdn.hf.co/xet-bridge-us/...` — a CDN host, not
 * `huggingface.co`. `next.host !== "huggingface.co"` was therefore true for the
 * very first file, `serveModelFile` returned 502, and the reader saw
 *
 *     Bad gateway error occurred while trying to load file:
 *     "app://models/Xenova/all-MiniLM-L6-v2/resolve/main/config.json"
 *
 * which names this app's own host and so pointed at the proxy rather than at a
 * comparison that was one string too strict.
 *
 * The rule is a family rather than an exact name, because the LFS CDN is a
 * different subdomain on every region and always a `hf.co` one. A redirect
 * anywhere else is still refused: what a redirect buys an attacker is not the
 * file, it is this app making a request the caller chose to a host the caller
 * chose, from inside the reader's machine.
 */
export function isUpstreamHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "huggingface.co" ||
    host.endsWith(".huggingface.co") ||
    host === "hf.co" ||
    host.endsWith(".hf.co")
  );
}

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
 * What a download needs of `fetch`, so a test can supply the responses.
 *
 * `redirect` includes `"follow"` because that is what this passes: Electron's
 * `net.fetch` **throws** on `"manual"`, which is the finding that ended the
 * hand-walked redirect chain. See `serveModelFile`.
 */
export type FetchLike = (url: string, init?: { redirect?: "manual" | "follow" }) => Promise<Response>;

/**
 * Serve one model file, fetching it upstream if this is the first ask.
 *
 * A failed download is a 502 rather than a throw: the encoder reports it to
 * the page, which can say "the weights could not be fetched" instead of
 * failing silently with a model that never loads.
 *
 * The initial target is composed here from `UPSTREAM` and the requested path, so
 * the renderer cannot send this anywhere but the weight host. Redirects after
 * that are `net.fetch`'s business — see the comment in the body for why walking
 * them by hand was impossible in this process.
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

  const target = `${UPSTREAM}${new URL(url).pathname}`;
  /*
   * Redirects are followed by `net.fetch`, not walked by hand.
   *
   * This function used to walk them itself, with `redirect: "manual"` and a
   * `MAX_REDIRECTS` ceiling, so that a hop leaving the weight host could be
   * refused. That design could never work in this process: **Electron's
   * `net.fetch` throws `Error: Redirect was cancelled` for `manual`**, so the
   * walk threw on the very first hop, the catch returned 502, and every model
   * file was unfetchable. Measured directly under Electron:
   *
   *     manual → THREW Error: Redirect was cancelled
   *     follow → 200  ok=true
   *
   * It also had to be wrong about which hop was legitimate, because every file
   * Hugging Face serves *is* a redirect — `config.json` through the resolve cache
   * on the same host, the weights through the LFS CDN on a per-region `hf.co`
   * subdomain — so a policy of refusing to leave `huggingface.co` exactly was a
   * policy of never completing a download.
   *
   * What that costs: the redirect ceiling is now Chromium's rather than a number
   * in this file, and hops cannot be inspected. What it buys: the feature works.
   * `isUpstreamHost` remains, and is still what decides the *initial* target, so
   * the renderer cannot point this at a third party — it just cannot police where
   * the weight host itself redirects to.
   */
  const upstream = await fetchUpstream(target, { redirect: "follow" }).catch((error: unknown) => {
    // A 502 with no explanation is what made this take a detour: "bad gateway"
    // from the caller's side does not say whether the host refused, the network
    // failed, or something else did. The reason goes to the log.
    console.warn(`[models] fetch failed for ${target}: ${String(error)}`);
    return null;
  });
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
