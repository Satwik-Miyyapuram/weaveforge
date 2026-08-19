"use client";

import type { EditorView } from "@codemirror/view";
import { imageAltFromFilename, looksLikeImageUrl, type PasteSettings } from "@weaveforge/core";
import { outboundFetch } from "@/lib/outbound-fetch";
import { insertPending, resolvePending, trackPending } from "./markdown-pending-insert";
import type { ImagePasteConfig } from "./markdown-image-paste";

/**
 * What happens after a URL has been pasted.
 *
 * Two behaviours, and both are deliberately *after* the paste rather than
 * instead of it. The address goes into the note the moment the reader presses
 * the key; the fetch runs beside it and rewrites what is already there. A paste
 * that waited on a third-party site would be a paste that sometimes takes four
 * seconds, and a note editor cannot afford that.
 *
 * Failure is quiet on purpose. If a title cannot be read, the note keeps a
 * working link — which is what was pasted, and what a person would have written
 * anyway. Only the image download reports, because there the reader is left
 * with a link where they expected a picture.
 */

/** One http(s) address and nothing else. */
const BARE_URL = /^https?:\/\/\S+$/;

/** A name for a picture that arrived with no filename of its own. */
function nameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || "image";
  } catch {
    return "image";
  }
}

/** `[label](url)`, with the characters that would end the label early escaped. */
function markdownLink(label: string, url: string): string {
  const safe = label.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  return `[${safe.trim()}](${url})`;
}

function describe(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "That address could not be fetched.";
}

export interface RemotePasteOptions {
  settings: () => PasteSettings;
  /** Where a downloaded picture is stored. Absent means image URLs stay links. */
  images?: ImagePasteConfig;
}

/**
 * Called once the cleaned text is in the document.
 *
 * `from`/`to` is where it landed. Returns nothing: whatever it starts happens
 * on its own, and the caller has already finished the paste.
 */
export function afterUrlPaste(
  view: EditorView,
  text: string,
  from: number,
  to: number,
  options: RemotePasteOptions,
): void {
  if (!BARE_URL.test(text)) return;
  const settings = options.settings();

  if (settings.downloadPastedImages && options.images && looksLikeImageUrl(text)) {
    downloadImage(view, text, from, to, options.images);
    return;
  }

  if (settings.fetchLinkTitles) fetchTitle(view, text, from, to);
}

/**
 * Replaces a pasted image URL with the picture itself.
 *
 * The address is what Safari's "copy image" puts on the clipboard, and a note
 * that keeps it is a note whose figure disappears when the site reorganises.
 * The placeholder is dimmed here — unlike the title case — because what is on
 * screen is not yet what the reader asked for.
 */
function downloadImage(
  view: EditorView,
  url: string,
  from: number,
  to: number,
  images: ImagePasteConfig,
): void {
  const name = nameFromUrl(url);
  const placeholder = `![Downloading ${imageAltFromFilename(name)}…]()`;
  // Replace the URL with a placeholder rather than tracking it: the reader
  // asked for a picture, and leaving the address there implies it is the answer.
  view.dispatch({ changes: { from, to, insert: placeholder } });
  const id = trackPending(view, from, from + placeholder.length, { dim: true });

  void outboundFetch()
    .image(url)
    .then(async (result) => {
      const file = new File([result.blob], name, { type: result.blob.type });
      return images.upload(file);
    })
    .then((markdown) => resolvePending(view, id, markdown))
    .catch((error: unknown) => {
      // The link is put back, because it is still the thing that was pasted and
      // it still works. Only then is the reason worth saying.
      resolvePending(view, id, url);
      images.onError?.(describe(error));
    });
}

/**
 * Turns a pasted link into a titled one once the title arrives.
 *
 * The URL is tracked rather than replaced, and not dimmed: it is already a
 * working link, and dimming it would suggest otherwise.
 */
function fetchTitle(view: EditorView, url: string, from: number, to: number): void {
  const id = trackPending(view, from, to);
  void outboundFetch()
    .title(url)
    .then(({ title }) => {
      if (title) resolvePending(view, id, markdownLink(title, url));
    })
    .catch(() => {
      // Quietly: the note has a working link, which is what was pasted.
      resolvePending(view, id, url);
    });
}

/**
 * Inserts a placeholder and downloads, for a picture that arrived without a
 * paste — dragged in from another tab, a mail client or a document, where what
 * crosses is the address rather than the file.
 *
 * A failure leaves the address, exactly as the paste path does: it is still
 * where the picture lives, and a drop that ends in nothing at all looks like
 * the editor ignored it.
 */
export function insertRemoteImage(view: EditorView, url: string, images: ImagePasteConfig): void {
  const name = nameFromUrl(url);
  const id = insertPending(view, `![Downloading ${imageAltFromFilename(name)}…]()`);
  void outboundFetch()
    .image(url)
    .then((result) => images.upload(new File([result.blob], name, { type: result.blob.type })))
    .then((markdown) => resolvePending(view, id, markdown))
    .catch((error: unknown) => {
      resolvePending(view, id, url);
      images.onError?.(describe(error));
    });
}
