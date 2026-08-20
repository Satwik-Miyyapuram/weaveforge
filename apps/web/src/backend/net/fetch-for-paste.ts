import { extractPageTitle } from "@weaveforge/core";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch";

/**
 * The two outbound fetches a paste can ask for: the title behind a link, and
 * the bytes behind an image URL.
 *
 * Kept apart from the API route on purpose. In a browser these have to be an
 * HTTP round trip, because the site is a different origin and CORS says no. In
 * the desktop app there is no such barrier and no server — the main process
 * calls these functions directly. Same guard, same limits, same messages, one
 * implementation; the route and the Electron handler are each about ten lines
 * of shaping on top.
 */

/** Bigger than any page's head, smaller than a download service. */
const TITLE_BYTES = 512 * 1024;
/** A figure, not a video. */
const IMAGE_BYTES = 12 * 1024 * 1024;

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp|tiff)$/i;

export type FetchFailure = { ok: false; status: number; message: string };

export type TitleResult = { ok: true; title: string; url: string } | FetchFailure;

export type ImageResult =
  | { ok: true; url: string; contentType: string; body: Uint8Array }
  | FetchFailure;

/** Reads the title a site would want shown when somebody links to it. */
export async function fetchPageTitle(target: string, options: SafeFetchOptions = {}): Promise<TitleResult> {
  const result = await safeFetch(target, {
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    maxBytes: TITLE_BYTES,
    ...options,
  });
  if (!result.ok) return { ok: false, status: result.status, message: result.message };

  // A PDF or an image has no title to read, and decoding megabytes of one to
  // find that out helps nobody.
  if (!/^text\/html|^application\/xhtml/i.test(result.contentType)) {
    return { ok: false, status: 415, message: "That address is not a web page." };
  }

  const found = extractPageTitle(new TextDecoder().decode(result.body));
  if (!found) return { ok: false, status: 404, message: "That page has no title." };
  if (found.suspect) {
    // It answered 200 with a challenge screen, so its title is the challenge.
    // Using it would produce a link that looks like it worked.
    return { ok: false, status: 403, message: "That site blocked automated access." };
  }

  return { ok: true, title: found.title, url: result.url };
}

/** Downloads a picture, refusing anything that does not say it is one. */
export async function fetchRemoteImage(target: string, options: SafeFetchOptions = {}): Promise<ImageResult> {
  const result = await safeFetch(target, { accept: "image/*", maxBytes: IMAGE_BYTES, ...options });
  if (!result.ok) return { ok: false, status: result.status, message: result.message };

  const contentType = result.contentType.split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES.test(contentType)) {
    // Deliberately not sniffed from the bytes. A server that echoes whatever it
    // is sent, served back through our own origin, is a stored-XSS delivery
    // mechanism — and SVG is a script carrier even when it is honest.
    return { ok: false, status: 415, message: "That address is not an image." };
  }

  return { ok: true, url: result.url, contentType, body: result.body };
}
