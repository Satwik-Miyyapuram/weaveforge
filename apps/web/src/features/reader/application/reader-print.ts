/**
 * A paper on paper: every page with its marks, and — when asked — the comments
 * beside each page, the way the writing margin shows them on screen.
 *
 * With comments the sheet is A4 landscape: the page on the left, its cards on
 * the right, each level with the mark it belongs to. Without, the page is all
 * there is, so it is A4 portrait and fitted to the sheet. A paper with no
 * comments at all prints portrait either way; an empty margin is wasted paper.
 */

/** One comment card beside a printed page. */
export interface ReaderPrintNote {
  /** Offset from the top of the page, in the page image's own pixels. */
  top: number;
  colour: string;
  /** The marked text, when the mark was on text. */
  quote: string;
  comment: string;
}

/** One printed page: its raster (marks drawn in) and its comments. */
export interface ReaderPrintPage {
  image: string;
  /** The raster's size in pixels; the notes' `top` is in the same units. */
  width: number;
  height: number;
  notes: readonly ReaderPrintNote[];
}

export type ReaderPrintOrientation = "portrait" | "landscape";

/** Landscape only when there is a margin to print. */
export function readerPrintOrientation(
  withComments: boolean,
  pages: readonly Pick<ReaderPrintPage, "notes">[],
): ReaderPrintOrientation {
  return withComments && pages.some((page) => page.notes.length > 0) ? "landscape" : "portrait";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A colour safe to put in a style attribute, or the ink colour. */
function safeColour(colour: string): string {
  return /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i.test(colour) ? colour : "#1f2a44";
}

/** Longest quote kept on a card; the page itself carries the rest. */
const QUOTE_LIMIT = 160;

function noteCard(note: ReaderPrintNote, pageHeight: number): string {
  const top = pageHeight > 0 ? (note.top / pageHeight) * 100 : 0;
  const quote = note.quote.trim();
  const clipped = quote.length > QUOTE_LIMIT ? `${quote.slice(0, QUOTE_LIMIT - 1)}…` : quote;
  return (
    `<div class="note" style="top:${top.toFixed(3)}%;border-left-color:${safeColour(note.colour)}">` +
    (clipped ? `<p class="quote">${escapeHtml(clipped)}</p>` : "") +
    `<p class="comment">${escapeHtml(note.comment.trim())}</p>` +
    `</div>`
  );
}

/** The whole print document, ready for a frame's `srcdoc`. */
export function readerPrintDocument(input: {
  title: string;
  pages: readonly ReaderPrintPage[];
  withComments: boolean;
}): string {
  const orientation = readerPrintOrientation(input.withComments, input.pages);
  const margin = orientation === "landscape";
  // No page margin and no frame: the page is printed at the sheet's own size, so
  // what comes out is a plain A4 to write on. 297 x 210 landscape, 210 x 297 portrait.
  const sheetHeight = margin ? 210 : 297;
  const sheetWidth = margin ? 297 : 210;
  const sheets = input.pages
    .map((page, index) => {
      const img = `<img src="${page.image}" alt="Page ${index + 1}" />`;
      if (!margin) return `<section class="sheet">${img}</section>`;
      const notes = page.notes.map((note) => noteCard(note, page.height)).join("");
      return (
        `<section class="sheet">` +
        `<div class="page" style="aspect-ratio:${page.width} / ${page.height}">${img}</div>` +
        `<div class="margin">${notes}</div>` +
        `</section>`
      );
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(input.title)}</title>
<style>
@page { size: A4 ${orientation}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #1f2a44; font-family: Rubik, system-ui, sans-serif; }
.sheet { width: ${sheetWidth}mm; height: ${sheetHeight}mm; display: flex; gap: 0; align-items: flex-start; justify-content: center; break-after: page; page-break-after: always; overflow: hidden; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
.sheet > img { display: block; width: 100%; height: 100%; object-fit: contain; }
.page { height: 100%; flex: none; }
.page img { display: block; width: 100%; height: 100%; }
.margin { position: relative; height: 100%; flex: 1; min-width: 0; margin: 0 8mm 0 4mm; }
.note { position: absolute; left: 0; right: 0; border-left: 1.6mm solid; background: #fff; padding: 1mm 2mm; font-size: 8pt; line-height: 1.3; }
.note p { margin: 0; }
.note .quote { color: #5b6275; font-style: italic; margin-bottom: 1mm; }
@media screen { body { background: #e8e4da; padding: 12px; } .sheet { background: #fff; margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(0,0,0,.25); } }
</style></head><body>${sheets}</body></html>`;
}
