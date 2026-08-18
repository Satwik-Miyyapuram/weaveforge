"use client";

import { StateEffect, StateField, EditorSelection, type ChangeSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { imageAltFromFilename } from "@weaveforge/core";

/**
 * Pasting and dropping images into a note.
 *
 * The upload takes a second or two and the writer is mid-sentence, so nothing
 * here blocks: a placeholder goes in at the caret straight away, the upload runs
 * beside it, and the real link replaces the placeholder when it lands. That
 * means the placeholder has to survive everything the writer does in between —
 * typing before it, deleting after it, pasting a second image on top of the
 * first — which is why its position lives in a `StateField` that CodeMirror maps
 * through every intervening change rather than in a remembered offset. An
 * offset would be wrong the moment anyone typed.
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

let nextId = 0;

interface Placeholder {
  id: number;
  from: number;
  to: number;
}

const addPlaceholder = StateEffect.define<Placeholder>();
const dropPlaceholder = StateEffect.define<number>();

/**
 * Live placeholder positions.
 *
 * `tr.changes.mapPos` moves each end through whatever the writer did, and the
 * assoc arguments decide who owns text inserted exactly at an edge. Both point
 * outward from the placeholder: text typed at its start stays in front of it
 * (`from` moves past the insertion) and text typed at its end stays behind it
 * (`to` holds still). Pointing them the other way makes the placeholder
 * swallow whatever the writer typed next, and the upload then deletes it.
 */
const placeholders = StateField.define<Placeholder[]>({
  create: () => [],
  update(current, tr) {
    let next = current;
    if (tr.docChanged) {
      next = next.map((placeholder) => ({
        id: placeholder.id,
        from: tr.changes.mapPos(placeholder.from, 1),
        to: tr.changes.mapPos(placeholder.to, -1),
      }));
    }
    for (const effect of tr.effects) {
      if (effect.is(addPlaceholder)) next = [...next, effect.value];
      else if (effect.is(dropPlaceholder)) next = next.filter((p) => p.id !== effect.value);
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (list) =>
      list.length === 0
        ? Decoration.none
        : (Decoration.set(
            list
              .filter((p) => p.to > p.from)
              .map((p) => PENDING_MARK.range(p.from, p.to)),
            true,
          ) as DecorationSet),
    ),
});

/** Dims the placeholder so it reads as "not yet part of the note". */
const PENDING_MARK = Decoration.mark({ class: "cm-image-uploading" });

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
 */
function acceptImages(view: EditorView, files: readonly File[], config: ImagePasteConfig): void {
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

    const alt = imageAltFromFilename(file.name);
    const text = placeholderText(alt);
    const id = ++nextId;

    // Inserted at the caret, which is the whole point: an image belongs where
    // the writer was, not at the end of the note the way the attach button has
    // always put it.
    const range = view.state.selection.main;
    const from = range.from;
    view.dispatch({
      changes: { from, to: range.to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
      effects: addPlaceholder.of({ id, from, to: from + text.length }),
      userEvent: "input.paste.image",
    });

    void config
      .upload(file)
      .then((markdown) => replacePlaceholder(view, id, markdown))
      .catch((error: unknown) => {
        replacePlaceholder(view, id, "");
        config.onError?.(describe(error));
      });
  }
}

/**
 * Swaps a placeholder for its final markdown, wherever it has drifted to.
 *
 * Two ways there is nothing to swap. The view may have been torn down — the
 * note closed, the screen navigated away — in which case the upload still
 * happened and the image is stored, just not referenced. Or the placeholder may
 * have collapsed to nothing because the writer deleted it, which is what
 * pressing undo straight after pasting does: the image is deliberately not put
 * back, since a picture appearing in a note somebody has just cleared is worse
 * than an unreferenced blob in storage.
 */
function replacePlaceholder(view: EditorView, id: number, markdown: string): void {
  const placeholder = view.state.field(placeholders, false)?.find((p) => p.id === id);
  if (!placeholder) return;
  if (placeholder.to <= placeholder.from) {
    view.dispatch({ effects: dropPlaceholder.of(id) });
    return;
  }

  const changes: ChangeSpec = { from: placeholder.from, to: placeholder.to, insert: markdown };
  view.dispatch({
    changes,
    effects: dropPlaceholder.of(id),
    // Only moved when the caret is still sitting where the placeholder was; a
    // writer who has moved on keeps their place.
    selection:
      view.state.selection.main.head === placeholder.to
        ? EditorSelection.cursor(placeholder.from + markdown.length)
        : undefined,
    userEvent: "input.paste.image",
  });
}

/** Styling for the pending placeholder. */
const pendingTheme = EditorView.baseTheme({
  ".cm-image-uploading": {
    opacity: "0.55",
    fontStyle: "italic",
  },
});

/**
 * The extension. Returns nothing when the host has no uploader, so a screen
 * that cannot store an image simply keeps the browser's own behaviour.
 */
export function imagePaste(config: ImagePasteConfig | undefined) {
  if (!config) return [];

  return [
    placeholders,
    pendingTheme,
    EditorView.domEventHandlers({
      paste: (event, view) => {
        // A bitmap on the clipboard is a reliable signal of intent: a copied
        // text selection never carries one, even when it contains a picture,
        // while a screenshot and a browser's "copy image" carry nothing else.
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        acceptImages(view, files, config);
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
        acceptImages(view, files, config);
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
