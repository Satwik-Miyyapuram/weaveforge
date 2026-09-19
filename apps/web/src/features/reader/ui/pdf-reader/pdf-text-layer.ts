/**
 * The page's text layer, built by PDF.js's own `TextLayer`.
 *
 * Copied from the reader implementation in `extra stuff to add/` that gets
 * selection right. The layer used to be hand-placed: one span per run, at a
 * position and font size computed here from the run's transform. That is a
 * second implementation of PDF.js's own layout, and it disagreed with the
 * glyphs on every page — selection ran wide of the words, a citation's
 * underline sat beside its number. `TextLayer` measures each run against the
 * font it is drawn in and scales the span to the width the glyphs actually
 * take, which is what makes the invisible text lie over the visible text.
 *
 * Link boxes are measured against that same layout: the characters under a
 * `/Link` are found with DOM `Range` rectangles, never by dividing a run's
 * width by its character count.
 */
import type { PageViewport, TextLayer } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { PageTextItem, PdfLink } from "@weaveforge/core";
import type { PdfLib } from "@/lib/pdf-lib";

/**
 * `lib` is the loaded pdf.js, passed in rather than imported: the bundle is a
 * megabyte and `loadPdfLib` is what keeps it off the first paint.
 */
export function createPdfTextLayer(
  lib: PdfLib,
  container: HTMLElement,
  content: TextContent,
  viewport: PageViewport,
): TextLayer {
  container.classList.add("pdf-text-content");
  // pdf.js 4.x reads `--scale-factor`; the layer's own `setLayerDimensions`
  // sizes the container and stamps its rotation.
  container.style.setProperty("--scale-factor", String(viewport.scale));
  container.style.setProperty("--scale-round-x", "0.01px");
  container.style.setProperty("--scale-round-y", "0.01px");
  return new lib.TextLayer({ container, textContentSource: content, viewport });
}

interface Box { left: number; top: number; right: number; bottom: number }

function intersects(a: Box, b: Box): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
    Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

function containsCharacter(link: Box, glyph: Box): boolean {
  if (!intersects(link, glyph)) return false;
  const width = glyph.right - glyph.left;
  const height = glyph.bottom - glyph.top;
  if (width <= 0 || height <= 0) return false;
  const x = (glyph.left + glyph.right) / 2;
  const y = (glyph.top + glyph.bottom) / 2;
  return x >= link.left && x <= link.right && y >= link.top && y <= link.bottom;
}

// Measure character boundaries in PDF.js's actual DOM layout. Never infer an
// individual character's width by dividing the total run width by its length.
export function measureLinkTextRanges(
  shell: HTMLElement,
  textDivs: readonly HTMLElement[],
  items: readonly PageTextItem[],
  links: readonly PdfLink[],
  viewport: PageViewport,
): PdfLink[] {
  const origin = shell.getBoundingClientRect();
  let cursor = 0;
  const runs = items.map((item, index) => {
    const start = cursor;
    cursor += item.str.length + (item.hasEOL ? 1 : 0);
    const node = textDivs[index]?.firstChild;
    return { item, start, node, box: textDivs[index]?.getBoundingClientRect() };
  });
  const glyphCache = new Map<number, { start: number; end: number; box: DOMRect }[]>();
  return links.map((link) => {
    if (link.url || !link.dest) return link;
    const projected = viewport.convertToViewportRectangle(link.rect);
    const box = {
      left: origin.left + Math.min(projected[0]!, projected[2]!),
      right: origin.left + Math.max(projected[0]!, projected[2]!),
      top: origin.top + Math.min(projected[1]!, projected[3]!),
      bottom: origin.top + Math.max(projected[1]!, projected[3]!),
    };
    const ranges: { start: number; end: number }[] = [];
    runs.forEach((run, index) => {
      if (!run.node || run.node.nodeType !== Node.TEXT_NODE || !run.item.str.trim() || !run.box || !intersects(box, run.box)) return;
      let glyphs = glyphCache.get(index);
      if (!glyphs) {
        glyphs = [];
        const range = document.createRange();
        let offset = 0;
        for (const character of run.item.str) {
          range.setStart(run.node, offset);
          range.setEnd(run.node, offset + character.length);
          glyphs.push({ start: offset, end: offset + character.length, box: range.getBoundingClientRect() });
          offset += character.length;
        }
        glyphCache.set(index, glyphs);
      }
      let active: { start: number; end: number } | null = null;
      for (const glyph of glyphs) {
        if (containsCharacter(box, glyph.box)) {
          if (active && active.end === run.start + glyph.start) active.end = run.start + glyph.end;
          else {
            active = { start: run.start + glyph.start, end: run.start + glyph.end };
            ranges.push(active);
          }
        } else active = null;
      }
    });
    return { ...link, textRanges: ranges };
  });
}

/**
 * Measure a page's internal links against a throwaway text layer, off screen.
 * Links are read before any page is drawn, so the layout is built for the
 * measurement and discarded.
 */
export async function measurePdfLinks(
  lib: PdfLib,
  content: TextContent,
  viewport: PageViewport,
  items: readonly PageTextItem[],
  links: readonly PdfLink[],
): Promise<PdfLink[]> {
  if (!links.some((link) => !link.url)) return [...links];
  const shell = document.createElement("div");
  shell.className = "pdf-measure-shell";
  shell.setAttribute("aria-hidden", "true");
  shell.style.width = `${viewport.width}px`;
  shell.style.height = `${viewport.height}px`;
  const host = document.createElement("div");
  shell.append(host);
  document.body.append(shell);
  let layer: TextLayer | undefined;
  try {
    layer = createPdfTextLayer(lib, host, content, viewport);
    await layer.render();
    if (layer.textDivs.length !== items.length || layer.textContentItemsStr.some((str, i) => str !== items[i]?.str)) {
      throw new Error("PDF text items and layout nodes do not match.");
    }
    return measureLinkTextRanges(shell, layer.textDivs, items, links, viewport);
  } finally {
    layer?.cancel();
    shell.remove();
  }
}
