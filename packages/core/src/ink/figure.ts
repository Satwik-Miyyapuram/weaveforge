/**
 * Figures: images placed on a page, in the text that already carries the page.
 *
 * A page of an ink note is markdown whose body is the recognised text layer;
 * a figure is one more image ref in that body — `![figure x=… y=… w=… h=…](vault:…)`
 * — so it lives where the note's own image bookkeeping already looks, moves
 * with the page under the CRDT, and survives as text in git. The same tokens
 * after an image's own alt text (`![photo right c=0,0,10,10|60%]`) place a
 * markdown note's image, because the two should not grow two syntaxes.
 *
 * The tokens are page units — tenths of a millimetre, the units every other
 * ink coordinate is in — except `c`, which is crop insets as percentages of
 * the image's own box (left, top, right, bottom) the way every crop tool
 * numbers them. A crop is geometry, not destruction: the bytes are untouched
 * and the crop is undone by clearing the token.
 */

/** The alt text that marks an image ref as a placed figure rather than prose. */
export const FIGURE_ALT = "figure";

/** An image placement: where on the page, how big, and how much of it shows. */
export interface FigureGeometry {
  /** The attachment this figure shows, without the `vault:` scheme. */
  path: string;
  /** The box's top-left corner from the page's top-left, in page units. */
  x: number;
  y: number;
  /** The box's size, in page units. */
  w: number;
  h: number;
  /**
   * How much of the image is cropped off, as percentages of its own box:
   * `[left, top, right, bottom]`, each 0–99. Absent means the whole image.
   */
  crop?: [number, number, number, number];
}

const TOKEN = /\b([a-z])=([0-9.,-]+)/g;

/**
 * The geometry tokens in an image alt, or `null` when there are none.
 *
 * `x`/`y`/`w`/`h` are the page-unit box; `c` (or the long `crop`) is the four
 * crop insets. Unknown tokens are left alone — they may belong to the alt's
 * own text — and a box that is not complete (`x` without `w`) is not a
 * placement, because half a box cannot be drawn.
 */
export function parseFigureTokens(
  alt: string,
): Omit<FigureGeometry, "path"> | null {
  let x: number | undefined;
  let y: number | undefined;
  let w: number | undefined;
  let h: number | undefined;
  let crop: [number, number, number, number] | undefined;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(alt)) !== null) {
    const key = match[1]!;
    const raw = match[2]!;
    if (key === "x") x = Number(raw);
    else if (key === "y") y = Number(raw);
    else if (key === "w") w = Number(raw);
    else if (key === "h") h = Number(raw);
    else if (key === "c") {
      const parts = raw.split(",").map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        crop = parts.map((n) => Math.min(99, Math.max(0, n))) as [
          number,
          number,
          number,
          number,
        ];
      }
    }
  }
  if (
    x === undefined ||
    y === undefined ||
    w === undefined ||
    h === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }
  return { x, y, w, h, ...(crop ? { crop } : {}) };
}

/** The geometry tokens as they are written in an alt, for a complete box. */
export function formatFigureTokens(geometry: Omit<FigureGeometry, "path">): string {
  const parts = [`x=${round(geometry.x)}`, `y=${round(geometry.y)}`, `w=${round(geometry.w)}`, `h=${round(geometry.h)}`];
  if (geometry.crop) {
    parts.push(`c=${geometry.crop.map(round).join(",")}`);
  }
  return parts.join(" ");
}

function round(value: number): number {
  // A tenth of a millimetre is already fine-grained; halves of them are noise.
  return Math.round(value * 10) / 10;
}

/** One figure line, as a page's text layer carries it. */
const FIGURE_LINE = /^!\[\s*figure\b([^\]]*)\]\(vault:([^)\s]+)\)$/;
/** Any image ref at all, so a figure's line can be found and replaced. */
const ANY_IMAGE = /!\[[^\]]*\]\(vault:([^)\s]+)\)/g;

/**
 * The figures a page's text layer places, in the order their lines appear.
 *
 * A figure's alt begins with the word `figure`; the first line of a page is
 * the page's background and is never one (its alt is `page background`).
 */
export function inkPageFigures(text: string): FigureGeometry[] {
  const figures: FigureGeometry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = FIGURE_LINE.exec(line.trim());
    if (!match) continue;
    const geometry = parseFigureTokens(match[1] ?? "");
    if (geometry) figures.push({ ...geometry, path: match[2]! });
  }
  return figures;
}

/**
 * A page's text layer with its figures set: the given lines replace the
 * existing ones, after the background line (which stays first) and before
 * the page's own text.
 *
 * Figures are the host's, not the recogniser's — recognition replaces a
 * page's text wholesale — so they are re-applied after every run, exactly the
 * way the background line is. Keeping them in one block at the top is what
 * makes that one operation rather than a diff.
 */
export function withInkPageFigures(
  text: string,
  figures: readonly FigureGeometry[],
): string {
  const BACKGROUND = /^!\[page background\]\(vault:([^)\s]+)\)$/;
  const lines = text.split(/\r?\n/);
  // The page's background stays first, whatever else changes (§4.8).
  const background =
    lines.length > 0 && BACKGROUND.test(lines[0]!.trim()) ? lines[0]!.trim() : null;
  const rest0 = lines
    .filter((line, index) => index > 0 || background === null)
    .filter((line) => !FIGURE_LINE.test(line.trim()))
    .join("\n")
    // The figure block's own blank separators go with it, so a re-application
    // does not accumulate gaps: every fully blank leading line is dropped.
    .replace(/^[^\S\n]*\n(?:[^\S\n]*\n)*/, "");
  const block = figures
    // A placement that cannot be drawn is not written: the reader filters it
    // out, so the writer and the reader agree about what a page holds.
    .filter(
      (figure) =>
        Number.isFinite(figure.x) &&
        Number.isFinite(figure.y) &&
        figure.w > 0 &&
        figure.h > 0,
    )
    .map((figure) => {
      const alt = `${FIGURE_ALT} ${formatFigureTokens(figure)}`;
      return `![${alt}](vault:${figure.path})`;
    });
  const rest =
    block.length === 0
      ? rest0.replace(/\s+$/, "")
      : [block.join("\n"), rest0].filter(Boolean).join("\n\n").replace(/\s+$/, "");
  if (background === null) return rest;
  return rest ? `${background}\n\n${rest}` : background;
}

/**
 * The figure a body's image ref at `path` is, by the alt it carries — for a
 * reader that has not split the body into pages yet. `null` when the ref is
 * not a placed figure.
 */
export function figureAltFor(body: string, path: string): string | null {
  ANY_IMAGE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANY_IMAGE.exec(body)) !== null) {
    if (match[1] !== path) continue;
    const altMatch = /^!\[([^\]]*)\]/.exec(match[0]);
    if (altMatch && FIGURE_LINE.test(match[0].trim())) return altMatch[1]!.trim();
    return null;
  }
  return null;
}

/** Where a figure moves in the page's stacking order. */
export type FigureOrderStep = "front" | "forward" | "backward" | "back";

/**
 * The figures with the one at `index` moved: the block's order is the paint
 * order, so "front" is the end of the array and "back" its start. A step
 * that cannot be taken (the top one, forward) leaves the order as it is.
 */
export function reorderFigures<T>(
  figures: readonly T[],
  index: number,
  step: FigureOrderStep,
): T[] {
  const next = [...figures];
  const one = next[index];
  if (one === undefined || index < 0) return next;
  const to =
    step === "front"
      ? next.length - 1
      : step === "back"
        ? 0
        : step === "forward"
          ? Math.min(next.length - 1, index + 1)
          : Math.max(0, index - 1);
  if (to === index) return next;
  next.splice(index, 1);
  next.splice(to, 0, one);
  return next;
}

/** A handle on a figure's box: a corner or an edge. */
export type FigureHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The handles a box shows, in reading order. */
export const FIGURE_HANDLES: readonly FigureHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * A box resized by dragging `handle` by (`dx`, `dy`) in page units. The
 * opposite side holds still. A corner keeps the box's aspect unless `free`,
 * because a photo does not become a different photo by being resized; an
 * edge only ever moves its own side, so it is free by nature. No side gets
 * shorter than `min`.
 */
export function resizeFigureBox(
  box: { x: number; y: number; w: number; h: number },
  handle: FigureHandle,
  dx: number,
  dy: number,
  options: { free?: boolean; min?: number } = {},
): { x: number; y: number; w: number; h: number } {
  const min = options.min ?? 30;
  const west = handle.includes("w");
  const north = handle.includes("n");
  const horizontal = handle !== "n" && handle !== "s";
  const vertical = handle !== "e" && handle !== "w";
  const growW = horizontal ? box.w + (west ? -dx : dx) : box.w;
  const growH = vertical ? box.h + (north ? -dy : dy) : box.h;
  let w = Math.max(min, growW);
  let h = Math.max(min, growH);
  if (horizontal && vertical && !options.free) {
    // A corner drag: whichever axis the hand moved further along wins and
    // the other follows, so the corner never lags the pointer.
    const aspect = box.w / Math.max(1, box.h);
    const movedW = Math.abs(growW - box.w) / Math.max(1, box.w);
    const movedH = Math.abs(growH - box.h) / Math.max(1, box.h);
    if (movedW >= movedH) h = Math.max(min, w / aspect);
    else w = Math.max(min, h * aspect);
  }
  return {
    x: Math.round(west ? box.x + box.w - w : box.x),
    y: Math.round(north ? box.y + box.h - h : box.y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/**
 * The rectangle the whole image would occupy if the figure's crop were
 * lifted: the box is the kept middle, so the full picture extends past it by
 * each inset's share. The crop tool draws this and lets the kept rectangle be
 * chosen inside it.
 */
export function uncroppedFigureBox(figure: Omit<FigureGeometry, "path">): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const [l, t, r, b] = figure.crop ?? [0, 0, 0, 0];
  const keepX = Math.max(1, 100 - l - r) / 100;
  const keepY = Math.max(1, 100 - t - b) / 100;
  const w = figure.w / keepX;
  const h = figure.h / keepY;
  return { x: figure.x - w * (l / 100), y: figure.y - h * (t / 100), w, h };
}

/**
 * Where the whole picture sits inside the figure's frame, as percentages of
 * the frame: the frame clips, and the picture is enlarged and shifted so the
 * cropped-out edges fall outside it. What the sheet and the print both draw
 * a figure with, so a crop looks the same on paper as on screen.
 */
export function figureImageFrame(figure: Omit<FigureGeometry, "path">): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const full = uncroppedFigureBox(figure);
  return {
    left: ((full.x - figure.x) / figure.w) * 100,
    top: ((full.y - figure.y) / figure.h) * 100,
    width: (full.w / figure.w) * 100,
    height: (full.h / figure.h) * 100,
  };
}

/**
 * A figure re-cropped to `kept`, a rectangle inside the uncropped image
 * `full`: the box becomes `kept` — what stays visible stays where it was on
 * the page — and the insets are what lies outside it, as percentages of the
 * whole picture. A crop that keeps everything clears the token.
 */
export function cropFigureTo(
  full: { x: number; y: number; w: number; h: number },
  kept: { x: number; y: number; w: number; h: number },
): Pick<FigureGeometry, "x" | "y" | "w" | "h" | "crop"> {
  const pct = (part: number, whole: number) =>
    Math.min(99, Math.max(0, Math.round((part / Math.max(1, whole)) * 1000) / 10));
  const l = pct(kept.x - full.x, full.w);
  const t = pct(kept.y - full.y, full.h);
  const r = pct(full.x + full.w - (kept.x + kept.w), full.w);
  const b = pct(full.y + full.h - (kept.y + kept.h), full.h);
  const box = {
    x: Math.round(kept.x),
    y: Math.round(kept.y),
    w: Math.max(1, Math.round(kept.w)),
    h: Math.max(1, Math.round(kept.h)),
  };
  if (l === 0 && t === 0 && r === 0 && b === 0) return box;
  return { ...box, crop: [l, t, r, b] };
}
