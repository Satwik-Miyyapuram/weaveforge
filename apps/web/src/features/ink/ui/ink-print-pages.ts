/**
 * The ink note on paper: every page on its own sheet, each with only its own
 * text, figures and ink.
 *
 * The DOM is read through the root the caller hands in, never through
 * `document`: a kept-alive tab or a split keeps several ink hosts mounted, and a
 * global lookup printed the first-mounted note's text under this note's ink.
 */

import type { InkPrintDocument, InkPrintFigure } from "@weaveforge/wasm";

import { readyCore } from "@/lib/rust-core";

/** What every sheet of one print shares. */
export type InkPrintShared = Omit<InkPrintDocument, "underlayHtml" | "figures" | "inkUrl" | "paper">;

/** One page's own layers. */
export interface InkPrintPageLayers {
  underlayHtml: string;
  figures: InkPrintFigure[];
  inkUrl?: string;
  paper: string;
}

/**
 * Page `pageIndex`'s rendered text inside `root`: the live page's (its fences
 * already upgraded) before its static slot. No root, nothing: never the whole
 * document.
 */
export function findPageUnderlay(
  root: ParentNode | null | undefined,
  pageIndex: number,
): Element | null {
  if (!root) return null;
  return (
    root.querySelector(`.ink-page-live[data-page="${pageIndex}"] .ink-sheet-text-underlay`) ??
    root.querySelector(`.ink-page[data-page="${pageIndex}"] .ink-sheet-text-underlay`)
  );
}

/** The page's text as markup: the sheet's own when it is in `root`, else `text` rendered afresh. */
export function pageUnderlayHtml(
  root: ParentNode | null | undefined,
  pageIndex: number,
  text: string,
  render: (text: string) => string,
): string {
  const shown = findPageUnderlay(root, pageIndex);
  if (shown) return shown.innerHTML;
  return text.trim() ? render(text) : "";
}

/** Sheets one under another on screen; one sheet per paper page in print. */
const PAGES_STYLE = `<style>
  body { flex-direction: column; align-items: center; gap: 24px; }
  .ink-print-page { flex: none; break-after: page; page-break-after: always; }
  .ink-print-page:last-child { break-after: auto; page-break-after: auto; }
  @media print { html, body { height: auto; } body { gap: 0; } }
</style>`;

function bodyOf(html: string): string {
  const start = html.indexOf("<body>");
  const end = html.lastIndexOf("</body>");
  return start === -1 || end === -1 ? "" : html.slice(start + "<body>".length, end).trim();
}

/**
 * One print document for all `pages`: each page is built by the one-page
 * `inkPrintDocument`, and their sheets are set one after another in the first
 * page's document, with a page break after each.
 */
export function inkPrintPagesDocument(
  shared: InkPrintShared,
  pages: readonly InkPrintPageLayers[],
): string {
  const docs = pages.map((page) => readyCore().inkPrintDocument({ ...shared, ...page }));
  if (docs.length <= 1) return docs[0] ?? "";
  const first = docs[0]!;
  const headEnd = first.indexOf("</head>");
  const bodyStart = first.indexOf("<body>") + "<body>".length;
  const bodyEnd = first.lastIndexOf("</body>");
  return (
    first.slice(0, headEnd) +
    PAGES_STYLE +
    "\n" +
    first.slice(headEnd, bodyStart) +
    "\n" +
    docs.map(bodyOf).join("\n") +
    "\n" +
    first.slice(bodyEnd)
  );
}
