import { safeFetch, type SafeFetchOptions } from "./safe-fetch";
import { typedCore } from "@/lib/rust-core";

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

type FetchFailure = { ok: false; status: number; message: string };

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
  if (!typedCore().isPasteHtmlContentType(result.contentType)) {
    return { ok: false, status: 415, message: "That address is not a web page." };
  }

  // Decode only the region a title can be in. `extractPageTitle` stops scanning
  // at `pageTitleScanChars()` characters, so decoding the tail is work thrown
  // away — and the body is already capped at `TITLE_BYTES` (512 KB) precisely so
  // one fetch cannot cost more than that. UTF-8 needs at least one byte per
  // character, so this can decode fewer characters than the limit but never
  // more: on an ASCII page it is exactly the same region, and on a multi-byte
  // one it can only miss a title more than 200 KB into the head.
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
    result.body.subarray(0, typedCore().pageTitleScanChars()),
  );
  const found = typedCore().extractPageTitle(decoded);
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

  // Not sniffed from the bytes: the allowlist is `paste_content`'s, and it refuses SVG.
  const contentType = typedCore().pasteImageType(result.contentType);
  if (contentType === undefined) {
    return { ok: false, status: 415, message: "That address is not an image." };
  }

  return { ok: true, url: result.url, contentType, body: result.body };
}
