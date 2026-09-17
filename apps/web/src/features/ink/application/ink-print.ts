/**
 * The page as a printable document: the sheet rebuilt out of its layers.
 *
 * A print that spent only the worker's raster dropped the note's text — the
 * markdown under the ink is DOM, not geometry the worker knows — and every
 * pasted figure with it. So the print is the sheet again, in a document of
 * its own: the paper with its ruling, the rendered markdown at the same
 * metrics as on screen, each figure in its frame, and the ink as one
 * transparent raster over all of it. Laid out at the screen's scale, so the
 * text flows onto the same rows the sheet showed, then scaled to the paper's
 * millimetres. Real text on paper (a PDF keeps it selectable), not a picture
 * of text.
 *
 * Pure: a string out of its inputs, so it can be checked without a browser.
 * The app's own stylesheets are linked in, which is what gives the sheet its
 * paper classes, the markdown its styles and KaTeX its fonts; the document
 * is printed light, because paper is.
 */

import { figureImageFrame, type FigureGeometry } from "@weaveforge/core";

import { escapeHtml } from "@/lib/escape-html";

/** A figure with the address of its picture: a data URL, so it needs no vault. */
export interface InkPrintFigure extends Omit<FigureGeometry, "path"> {
  url: string;
}

export interface InkPrintDocument {
  title: string;
  /** In 0.1 mm, the page's own units. */
  pageSize: { width: number; height: number };
  /** Pixels per page unit the sheet was laid out at on screen. */
  scale: number;
  /** The paper's name; `paper-${paper}` is the sheet's class. */
  paper: string;
  /** The underlay's markup (the rendered markdown), already HTML. */
  underlayHtml: string;
  /** The underlay's box, in CSS pixels at `scale`. */
  underlay: { padX: number; padY: number; fontSize: number; lineHeight: number };
  /** The ruling variables the sheet reads (`--ink-rule`, `--ink-rule-offset`). */
  rule: Record<string, string>;
  figures: readonly InkPrintFigure[];
  /** The ink and the page background, transparent where there is neither; null when the page has no raster. */
  inkUrl: string | null;
  /** The app's stylesheets: a link each, or the text of one with no address. */
  styleSheets: readonly { href?: string | null; text?: string | null }[];
}

/** CSS pixels per millimetre, as the CSS spec fixes it. */
const PX_PER_MM = 96 / 25.4;

/** The document, as HTML for a frame's `srcdoc`. */
export function inkPrintDocument(doc: InkPrintDocument): string {
  const widthMm = doc.pageSize.width / 10;
  const heightMm = doc.pageSize.height / 10;
  const widthPx = doc.pageSize.width * doc.scale;
  const heightPx = doc.pageSize.height * doc.scale;
  // The sheet at its screen size, shrunk (or grown) onto the paper.
  const fit = (widthMm * PX_PER_MM) / widthPx;
  const styles = doc.styleSheets
    .map((sheet) =>
      sheet.href
        ? `<link rel="stylesheet" href="${escapeHtml(sheet.href)}">`
        : sheet.text
          ? `<style>${sheet.text.replace(/<\/style/gi, "<\/style")}</style>`
          : "",
    )
    .join("\n");
  const rule = Object.entries(doc.rule)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  const figures = doc.figures
    .map((figure) => {
      const frame = figureImageFrame(figure);
      return (
        `<div class="ink-figure" style="position:absolute;left:${figure.x * doc.scale}px;top:${figure.y * doc.scale}px;width:${figure.w * doc.scale}px;height:${figure.h * doc.scale}px">` +
        `<div style="position:absolute;inset:0;overflow:hidden">` +
        `<img src="${escapeHtml(figure.url)}" alt="" style="position:absolute;width:${frame.width.toFixed(3)}%;height:${frame.height.toFixed(3)}%;left:${frame.left.toFixed(3)}%;top:${frame.top.toFixed(3)}%;object-fit:fill">` +
        `</div></div>`
      );
    })
    .join("");
  const ink = doc.inkUrl
    ? `<img class="ink-print-ink" src="${escapeHtml(doc.inkUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%">`
    : "";
  const underlay = doc.underlayHtml
    ? `<div class="ink-sheet-text-underlay markdown" style="position:absolute;inset:0;padding:${doc.underlay.padY}px ${doc.underlay.padX}px;font-size:${doc.underlay.fontSize}px;line-height:${doc.underlay.lineHeight};color:var(--text);overflow:hidden;word-break:break-word;opacity:0.88">${doc.underlayHtml}</div>`
    : "";
  return `<!doctype html>
<html data-mode="light">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
${styles}
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #e9e9e9; }
  body { display: flex; justify-content: center; padding: 24px 0; }
  .ink-print-page { position: relative; width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden; background: #fff; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); }
  .ink-print-page .ink-sheet { position: absolute; left: 0; top: 0; width: ${widthPx}px; height: ${heightPx}px; transform: scale(${fit}); transform-origin: 0 0; border-radius: 0; box-shadow: none; background-color: #fff; }
  .ink-print-page .ink-figure { box-shadow: none; background: none; }
  @media print {
    html, body { width: ${widthMm}mm; height: ${heightMm}mm; background: #fff; }
    body { display: block; padding: 0; }
    .ink-print-page { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="ink-print-page"><div class="ink-sheet paper-${escapeHtml(doc.paper)}" style="${rule}">${underlay}<div class="ink-figures">${figures}</div>${ink}</div></div>
</body>
</html>`;
}

/**
 * The app's stylesheets as the document links them: the linked ones by
 * address, the inline ones by text. A sheet whose rules cannot be read (a
 * cross-origin one) is linked by address or, failing that, left out.
 */
export function documentStyleSheets(
  root: Document,
): { href?: string | null; text?: string | null }[] {
  const sheets: { href?: string | null; text?: string | null }[] = [];
  for (const sheet of Array.from(root.styleSheets)) {
    if (sheet.href) {
      sheets.push({ href: sheet.href });
      continue;
    }
    try {
      sheets.push({
        text: Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n"),
      });
    } catch {
      // Unreadable and unaddressed: nothing to carry over.
    }
  }
  return sheets;
}
