import { keepFigureOnPage, type FigureGeometry } from "@weaveforge/core";

/**
 * A figure on the clipboard (§figure).
 *
 * A copied figure goes to the system clipboard twice over: as a PNG, so any
 * other app pastes the picture, and as a line of text naming the figure, so a
 * paste back into a note brings the figure itself — its box and its crop, and
 * the attachment it already has instead of a second upload of the same bytes.
 * The text is the note's own: a paste elsewhere shows it as one line, which is
 * why it says what it is.
 */

const PREFIX = "weaveforge-figure:";

/** What a copied figure carries: the note that owns its attachment, and the figure. */
export interface FigureClip {
  noteId: string;
  figure: FigureGeometry;
}

/** The clipboard text for a copied figure. */
export function figureClipText(clip: FigureClip): string {
  return `${PREFIX}${JSON.stringify(clip)}`;
}

/** The figure a clipboard text names, or `null` when it names none. */
export function parseFigureClip(text: string | null | undefined): FigureClip | null {
  if (!text?.startsWith(PREFIX)) return null;
  try {
    const clip = JSON.parse(text.slice(PREFIX.length)) as Partial<FigureClip> | null;
    const figure = clip?.figure;
    if (typeof clip?.noteId !== "string" || !figure || typeof figure.path !== "string") return null;
    if (![figure.x, figure.y, figure.w, figure.h].every((n) => Number.isFinite(n))) return null;
    const box = { path: figure.path, x: figure.x, y: figure.y, w: figure.w, h: figure.h };
    return {
      noteId: clip.noteId,
      figure:
        Array.isArray(figure.crop) && figure.crop.length === 4 && figure.crop.every(Number.isFinite)
          ? { ...box, crop: figure.crop }
          : box,
    };
  } catch {
    return null;
  }
}

/**
 * Where a pasted figure goes on its page: where it was copied from, stepped
 * down and right past any figure already sitting exactly there, so a copy
 * pasted beside its original is seen as a second one.
 */
export function pastedFigurePlace(
  figure: FigureGeometry,
  onPage: readonly FigureGeometry[],
  pageSize: { width: number; height: number },
): FigureGeometry {
  const STEP = 50;
  let { x, y } = figure;
  for (let tries = 0; tries < 20 && onPage.some((one) => one.x === x && one.y === y); tries += 1) {
    x += STEP;
    y += STEP;
  }
  return keepFigureOnPage({ ...figure, x, y }, pageSize);
}
