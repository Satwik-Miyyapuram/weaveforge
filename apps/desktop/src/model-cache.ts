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
import fs from "node:fs";
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
 * Serve one model file, fetching it upstream if this is the first ask.
 *
 * A failed download is a 502 rather than a throw: the encoder reports it to
 * the page, which can say "the weights could not be fetched" instead of
 * failing silently with a model that never loads.
 */
export async function serveModelFile(root: string, url: string): Promise<Response> {
  const file = cachePathFor(root, url);
  if (!file) return new Response(null, { status: 404 });

  const cached = await readFile(file).catch(() => null);
  if (cached) return new Response(new Uint8Array(cached), { status: 200, headers: headersFor(file) });

  const upstream = await net.fetch(`${UPSTREAM}${new URL(url).pathname}`).catch(() => null);
  if (!upstream || !upstream.ok) return new Response(null, { status: upstream?.status ?? 502 });

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

/** Whether anything has been cached yet, for the settings panel to say so. */
export function modelsCached(root: string): boolean {
  return fs.existsSync(root) && fs.readdirSync(root).length > 0;
}

function headersFor(file: string): Record<string, string> {
  const type = file.endsWith(".json")
    ? "application/json"
    : file.endsWith(".onnx")
      ? "application/octet-stream"
      : "text/plain; charset=utf-8";
  return { "content-type": type, "access-control-allow-origin": "*" };
}
