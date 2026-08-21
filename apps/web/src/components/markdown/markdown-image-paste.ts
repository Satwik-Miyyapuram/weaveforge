"use client";

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { imageAltFromFilename, looksLikeImageUrl } from "@weaveforge/core";
import {
  insertPending,
  pendingInsertSupport,
  resolvePending,
} from "@/components/markdown/markdown-pending-insert";
import { insertRemoteImage } from "@/components/markdown/markdown-remote-paste";

/**
 * Pasting and dropping images into a note.
 *
 * The upload takes a second or two and the writer is mid-sentence, so nothing
 * here blocks: a placeholder goes in at the caret straight away, the upload runs
 * beside it, and the real link replaces the placeholder when it lands. Keeping
 * track of where that placeholder went while the writer keeps typing is
 * `markdown-pending-insert`, which the URL fetches use too.
 */

/** What a host screen supplies to accept images. */
export interface ImagePasteConfig {
  /**
   * Store the file and return the markdown that references it.
   *
   * The markdown, not the path: each surface has its own prefix (`vault:`,
   * `reportimg:`, `paperimg:`) and its own compression policy, and none of that
   * belongs in the editor.
   */
  upload: (file: File) => Promise<string>;
  /** Told why an upload failed, so the screen can show it where it shows its other errors. */
  onError?: (message: string) => void;
  /** Files larger than this are refused before any work happens. Default 25 MB. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/** Bitmap types worth accepting. SVG is deliberately absent — it is a script carrier. */
const ACCEPTED = /^image\/(png|jpe?g|gif|webp|avif|bmp|tiff?|heic|heif)$/i;

/** The same list as extensions, for a file that arrived without a type. */
const ACCEPTED_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|heic|heif)$/i;

/**
 * Whether a file is a picture we will store.
 *
 * The name is consulted only when there is no type at all, which is what
 * Windows reports for an extension no application on that machine has claimed
 * — an `.avif` or a `.heic` on an older install. Refusing on no evidence would
 * mean the file silently vanished when dropped; `.svg` is in neither list, so
 * trusting the name here still cannot let a script carrier through.
 */
function isImageFile(file: File): boolean {
  return file.type ? ACCEPTED.test(file.type) : ACCEPTED_EXTENSION.test(file.name);
}

/** The text that stands in while the upload runs. */
function placeholderText(alt: string): string {
  // `![alt]()` and not a bare comment: if a tab is closed mid-upload and the
  // text is ever saved, what remains renders as its own alt text — a line that
  // says an upload was in flight, which is the truth.
  return `![Uploading ${alt}…]()`;
}

/**
 * Image files on a clipboard or a drag, in the order the OS listed them.
 *
 * `items` is asked first because it is the one every browser fills in on a
 * paste — `files` is left empty by Firefox there, so reading only that meant a
 * screenshot pasted in Firefox did nothing whatsoever. The two describe the
 * same clipboard, so whichever answers is the answer: reading both and
 * concatenating would insert every picture twice.
 *
 * `getAsFile` has to be called while the event is still being dispatched, which
 * is why this is a plain synchronous function and not a promise.
 */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];

  const fromItems = [...(data.items ?? [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null && isImageFile(file));
  if (fromItems.length > 0) return fromItems;

  return [...(data.files ?? [])].filter(isImageFile);
}

/**
 * Whether a bitmap on the clipboard is what the writer actually copied.
 *
 * Less obvious than it looks, and the difference shows up on Windows. Several
 * Windows applications — Word, Excel, Outlook — put a *rendered picture* of the
 * selection on the clipboard next to the text, and a browser hands that picture
 * over as a file like any other. An editor that takes whatever bitmap it is
 * offered therefore pastes a screenshot of the spreadsheet instead of the
 * spreadsheet, and the writer has no way to ask for the text.
 *
 * So text wins whenever there is any. What makes that safe rather than merely
 * cautious is that the cases wanting the picture offer nothing else: a
 * screenshot, a browser's "copy image", and a file copied in Explorer all
 * arrive with an empty `text/plain`. And when a site does put the image's
 * address there, the address is pasted instead — which downloads the same
 * picture, by the other route.
 */
function bitmapIsThePaste(data: DataTransfer | null): boolean {
  return data !== null && data.getData("text/plain").trim() === "";
}

/**
 * An image address in a drag that carried no file.
 *
 * Dragging a picture out of another tab, a mail client or a document does not
 * hand over a file — it hands over where the picture lives. Without this the
 * drop lands as a bare URL, which is exactly the link that stops working when
 * the other site is reorganised.
 *
 * `text/plain` is deliberately not consulted. Dragging a selection *inside* the
 * editor sets that and nothing else, and treating it as a drop target would
 * turn CodeMirror's own drag-to-move into a download whenever the moved text
 * happened to be an image URL.
 */
function imageUrlFrom(data: DataTransfer | null): string | null {
  if (!data) return null;

  for (const line of data.getData("text/uri-list").split(/\r?\n/)) {
    const candidate = line.trim();
    // `#` starts a comment in the uri-list format.
    if (candidate && !candidate.startsWith("#") && isDownloadableImage(candidate)) return candidate;
  }

  const embedded = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(data.getData("text/html"));
  if (embedded?.[1] && isDownloadableImage(embedded[1])) return embedded[1];

  return null;
}

/** A web address that points at a picture — not a `data:` or `blob:` one. */
function isDownloadableImage(url: string): boolean {
  return /^https?:\/\//i.test(url) && looksLikeImageUrl(url);
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The image could not be uploaded.";
}

/**
 * Inserts placeholders for `files` at the caret and starts their uploads.
 *
 * Each file gets its own placeholder and its own transaction, so two images
 * pasted together land in the order they were listed however their uploads
 * finish, and a failure takes out one placeholder rather than all of them.
 *
 * Exported because the attach-image button wants exactly this: a file chosen
 * from a dialog is the same event as a file off the clipboard, and it should
 * not arrive by a different route or land somewhere else.
 */
export function acceptImageFiles(
  view: EditorView,
  files: readonly File[],
  config: ImagePasteConfig,
): void {
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;

  for (const file of files) {
    if (file.size > maxBytes) {
      config.onError?.(
        `${file.name || "That image"} is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${(
          maxBytes / 1024 / 1024
        ).toFixed(0)} MB limit.`,
      );
      continue;
    }

    // Inserted at the caret, which is the whole point: an image belongs where
    // the writer was, not at the end of the note the way the attach button used
    // to put it.
    const id = insertPending(view, placeholderText(imageAltFromFilename(file.name)));

    void config
      .upload(file)
      .then((markdown) => resolvePending(view, id, markdown))
      .catch((error: unknown) => {
        resolvePending(view, id, "");
        config.onError?.(describe(error));
      });
  }
}

export interface ImagePasteOptions {
  /**
   * Whether a picture dragged in from somewhere else — which arrives as an
   * address rather than as a file — may be downloaded. The reader's
   * `downloadPastedImages` setting, read through a callback so turning it off
   * reaches editors that are already open. Absent means such a drop is left to
   * CodeMirror, which lands the address as text.
   */
  remoteImages?: () => boolean;
}

/**
 * The extension. Returns nothing when the host has no uploader, so a screen
 * that cannot store an image simply keeps the browser's own behaviour.
 */
export function imagePaste(config: ImagePasteConfig | undefined, options: ImagePasteOptions = {}) {
  if (!config) return [];

  /** Puts the caret where the pointer is, so a drop lands where it was dropped. */
  const caretAtDrop = (view: EditorView, event: DragEvent) => {
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (at !== null) view.dispatch({ selection: EditorSelection.cursor(at) });
  };

  return [
    ...pendingInsertSupport,
    EditorView.domEventHandlers({
      paste: (event, view) => {
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0 || !bitmapIsThePaste(event.clipboardData)) return false;
        event.preventDefault();
        acceptImageFiles(view, files, config);
        return true;
      },
      drop: (event, view) => {
        // A dropped file is unambiguous — nobody drags a spreadsheet cell onto
        // a note by accident — so unlike a paste it needs no test of intent.
        const files = imageFilesFrom(event.dataTransfer);
        if (files.length > 0) {
          event.preventDefault();
          caretAtDrop(view, event);
          acceptImageFiles(view, files, config);
          return true;
        }

        const url = options.remoteImages?.() ? imageUrlFrom(event.dataTransfer) : null;
        if (!url) return false;
        event.preventDefault();
        caretAtDrop(view, event);
        insertRemoteImage(view, url, config);
        return true;
      },
      dragover: (event) => {
        // Without this the browser navigates away to whatever was dropped, and
        // the note is gone. `types` rather than the files themselves because a
        // drag in progress hides its contents until it is dropped.
        const types = event.dataTransfer?.types;
        const droppable =
          types?.includes("Files") ||
          (options.remoteImages?.() === true &&
            (types?.includes("text/uri-list") || types?.includes("text/html")));
        if (droppable) event.preventDefault();
        return false;
      },
    }),
  ];
}
