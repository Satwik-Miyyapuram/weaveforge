"use client";

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { imageAltFromFilename } from "@weaveforge/core";
import {
  insertPending,
  pendingInsertSupport,
  resolvePending,
} from "./markdown-pending-insert";

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
const ACCEPTED = /^image\/(png|jpeg|gif|webp|avif|bmp|tiff|heic|heif)$/i;

/** The text that stands in while the upload runs. */
function placeholderText(alt: string): string {
  // `![alt]()` and not a bare comment: if a tab is closed mid-upload and the
  // text is ever saved, what remains renders as its own alt text — a line that
  // says an upload was in flight, which is the truth.
  return `![Uploading ${alt}…]()`;
}

/** Image files on a clipboard or a drag, in the order the OS listed them. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...(data.files ?? [])].filter((file) => ACCEPTED.test(file.type));
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

/**
 * The extension. Returns nothing when the host has no uploader, so a screen
 * that cannot store an image simply keeps the browser's own behaviour.
 */
export function imagePaste(config: ImagePasteConfig | undefined) {
  if (!config) return [];

  return [
    ...pendingInsertSupport,
    EditorView.domEventHandlers({
      paste: (event, view) => {
        // A bitmap on the clipboard is a reliable signal of intent: a copied
        // text selection never carries one, even when it contains a picture,
        // while a screenshot and a browser's "copy image" carry nothing else.
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        acceptImageFiles(view, files, config);
        return true;
      },
      drop: (event, view) => {
        const files = imageFilesFrom(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        // Dropped images land where they were dropped, not where the caret
        // happened to be — that is what a drop means.
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (at !== null) view.dispatch({ selection: EditorSelection.cursor(at) });
        acceptImageFiles(view, files, config);
        return true;
      },
      dragover: (event) => {
        // Without this the browser navigates away to the dropped file.
        if (imageFilesFrom(event.dataTransfer).length > 0 || event.dataTransfer?.types.includes("Files")) {
          event.preventDefault();
        }
        return false;
      },
    }),
  ];
}
