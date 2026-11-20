"use client";

import { useCallback, useState } from "react";
import { type FigureGeometry, type InkPage as InkPageModel, type InkStroke } from "@weaveforge/core";

import { blobToDataUrl, downloadBlob, readInkRenderer } from "@/lib/parts";
import { renderMarkdownPlain } from "@/components/markdown/markdown";
import type { InkSvgFigure } from "@weaveforge/wasm";
import { loadInOrder } from "../application/parts";
import { readInkTuning } from "../application/ink-tuning";
import { drawInkStrokes } from "./ink-page-canvas";
import { inkPrintPagesDocument, pageUnderlayHtml, findPageUnderlay, type InkPrintPageLayers } from "./ink-print-pages";
import type { InkPalette } from "../render/parts-1";
import { INK_UNDERLAY, inkSheetRuleStyle, loadMathOrLog } from "./ink-sheet-underlay";
import { readyCore, toWasmInkPage, typedCore } from "@/lib/rust-core";

/**
 * The app's stylesheets as the print document links them: the linked ones by
 * address, the inline ones by text. A sheet whose rules cannot be read (a
 * cross-origin one) is linked by address or, failing that, left out.
 */
function documentStyleSheets(
  root: Document,
): { href?: string; text?: string }[] {
  const sheets: { href?: string; text?: string }[] = [];
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

/**
 * Pixels per 0.1 mm unit in an exported or printed page.
 *
 * 2 is 508 dpi on A4 — enough that a printed page has no visible raster, and
 * what the PNG export has always used. The print lays the same raster over
 * the sheet's text, so paper and file match stroke for stroke.
 */
export const PNG_EXPORT_SCALE = 2;

/** What the three exports need from the editor; the host owns all of it. */
export interface PageExportDeps {
  /**
   * The worker's raster of the current page, or `null` when it has none. The
   * `transparent` flag asks for the ink without its sheet of white, for the
   * compose below.
   */
  requestExport: (scale?: number, transparent?: boolean) => Promise<Blob | null>;
  /** The worker's strokes for the current page, for the vector export. */
  requestModel: () => Promise<InkPageModel>;
  /** The note's id, which names the file. */
  noteId: string;
  /** 0-based, so the file says `page-1`. */
  pageIndex: number;
  /** The pages' text layers, where a page's background attachment is named. */
  textPages: { readonly current: string[] };
  /** The current page's size in 0.1 mm, which sizes a composed export. */
  pageSize: { width: number; height: number };
  /** The ink palette the SVG paints its strokes with. */
  palette: InkPalette;
  /** The vault, for the background bytes a vector export embeds. */
  fetchBlob: (path: string) => Promise<Blob>;
  /** Every page's flowed text, which the print sets under each page's ink. */
  pageTexts: { readonly current: readonly string[] };
  /** How many pages the note has; the print sets every one on its own sheet. */
  pageCount: number;
  /** Every page's saved strokes, for the pages the worker is not holding. */
  savedStrokes: ReadonlyMap<number, readonly InkStroke[]>;
  /**
   * The host's own root. The print reads the sheets' rendered text inside it
   * only: other notes can be mounted beside it (kept-alive tabs, a split).
   */
  root: { readonly current: HTMLElement | null };
  /** Pixels per page unit the sheet is laid out at, which the print keeps. */
  scale: number;
  /** The paper the sheet is drawn on (`paper-${paper}`). */
  paper: string;
}

/** A print waiting in its preview: the document and its title. */
export interface PendingPrint {
  html: string;
  title: string;
}

/**
 * Compose the worker's page raster with the page's figures into one PNG.
 *
 * The worker's export — asked `transparent` — is the ink alone: its strokes,
 * nothing behind them, because this lays the paper down itself. The figures
 * are not ink: they are DOM on the sheet, not geometry the worker knows, so
 * a print or a PNG that spent only the worker's raster would drop every
 * pasted photo from the note. This draws the white sheet, each figure at its
 * own page-unit box with its crop insets, then the ink over them: what comes
 * out is the page as it looks, not the page as the worker knows it.
 *
 * Pure canvas work, deliberately: the DOM is a window onto the sheet
 * (§6.2.14) and printing it would crop the page to the scroll.
 */
async function composeWithFigures(
  ink: Blob,
  figures: readonly FigureGeometry[],
  fetchBlob: (path: string) => Promise<Blob>,
  pageSize: { width: number; height: number },
  scale: number,
): Promise<Blob> {
  if (figures.length === 0) return ink;
  const inkBitmap = await createImageBitmap(ink);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(pageSize.width * scale);
    canvas.height = Math.round(pageSize.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("A 2D context could not be created for the export.");
    // The paper the composed page is laid on: a PNG has no CSS sheet behind
    // it, and the transparent ink raster brings none of its own.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    // The figures, then the ink over them: the sheet's own order. Fetched
    // together; a missing attachment is a figure the page does not draw.
    const loaded = await loadInOrder(figures, async (figure) => ({
      figure,
      bitmap: await createImageBitmap(await fetchBlob(figure.path)),
    }));
    for (const { figure, bitmap } of loaded) {
      const crop = figure.crop ?? [0, 0, 0, 0];
      const sx = (crop[0] / 100) * bitmap.width;
      const sy = (crop[1] / 100) * bitmap.height;
      const sw = (1 - (crop[0] + crop[2]) / 100) * bitmap.width;
      const sh = (1 - (crop[1] + crop[3]) / 100) * bitmap.height;
      context.drawImage(
        bitmap,
        sx,
        sy,
        Math.max(1, sw),
        Math.max(1, sh),
        figure.x * scale,
        figure.y * scale,
        figure.w * scale,
        figure.h * scale,
      );
      bitmap.close();
    }
    context.drawImage(inkBitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("The page could not be encoded."))),
        "image/png",
      ),
    );
  } finally {
    inkBitmap.close();
  }
}

/**
 * A page the worker is not holding, as the worker's transparent export would
 * draw it: its background image (if any) over the whole page, then its saved
 * strokes, drawn by the same code the page's canvas uses. `null` for a page
 * with neither.
 */
async function savedPageInk(
  strokes: readonly InkStroke[],
  background: Blob | null,
  pageSize: { width: number; height: number },
  palette: InkPalette,
): Promise<Blob | null> {
  const drawn = readyCore().toRenderStrokes(strokes, palette);
  if (drawn.length === 0 && !background) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(pageSize.width * PNG_EXPORT_SCALE);
  canvas.height = Math.round(pageSize.height * PNG_EXPORT_SCALE);
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (background) {
    const bitmap = await createImageBitmap(background);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  }
  if (drawn.length > 0) {
    drawInkStrokes(context, drawn, PNG_EXPORT_SCALE, readInkRenderer(), readInkTuning());
  }
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob((blob) => {
      // Drop the backing store now, not at the next collection.
      canvas.width = 0;
      canvas.height = 0;
      resolve(blob);
    }, "image/png"),
  );
}

/**
 * Getting the current page out of the editor: the print preview, a full-page
 * PNG, and the page as vector SVG.
 *
 * Out of the host because none of it is about the drawing surface — it is three
 * readers of state the host already holds, and each one ends in a file rather
 * than in the pane. The pixels come from the worker's raster rather than from
 * the DOM, because what the user sees is a *window* onto the sheet — the
 * canvas is the size of the viewport, not the page (§6.2.14) — so printing the
 * screen would crop the page to whatever happened to be scrolled into view.
 */
export function usePageExport(deps: PageExportDeps) {
  const {
    requestExport,
    requestModel,
    noteId,
    pageIndex,
    textPages,
    pageSize,
    palette,
    fetchBlob,
    pageTexts,
    pageCount,
    savedStrokes,
    root,
    scale,
    paper,
  } = deps;
  const fileBase = `${noteId}-page-${pageIndex + 1}`;

  /**
   * The worker's raster with the page's figures composed in, for the PNG. The
   * raster is asked for transparent whenever there is a figure to compose:
   * the compose draws the paper itself, and an opaque raster would cover the
   * figures with its own sheet of white.
   */
  const composedExport = useCallback(async () => {
    const figures = typedCore().inkPageFigures(textPages.current[pageIndex] ?? "");
    const ink = await requestExport(PNG_EXPORT_SCALE, figures.length > 0);
    if (!ink) return null;
    return composeWithFigures(
      ink,
      figures,
      fetchBlob,
      pageSize,
      PNG_EXPORT_SCALE,
    );
  }, [fetchBlob, pageIndex, pageSize, requestExport, textPages]);

  const onExportPng = useCallback(async () => {
    const png = await composedExport();
    if (!png) return;
    downloadBlob(png, `${fileBase}.png`);
  }, [composedExport, fileBase]);

  const [printDoc, setPrintDoc] = useState<PendingPrint | null>(null);
  const closePrint = useCallback(() => setPrintDoc(null), []);

  /**
   * The note for paper: every page on its own sheet, every layer of each, not the raster alone.
   *
   * The text is the underlay's own markup where the sheet is on screen (so a
   * Mermaid diagram already upgraded prints as the diagram), or the markdown
   * rendered afresh where it is not; the figures and the ink are embedded as
   * data URLs so the document needs no vault. The ink is asked for
   * transparent, which still carries the page's background image: only the
   * white is left out, and the print document lays its own paper down.
   */
  const onPrint = useCallback(async () => {
    const host = root.current;
    const count = Math.max(pageCount, 1);
    const texts = pageTexts.current;
    // A page whose sheet is in this host prints its own rendered text, which
    // has already waited for KaTeX; any other page's markdown is rendered
    // afresh, and maths there would come out as the placeholder unless the
    // renderer is in memory, so it is fetched first.
    for (let index = 0; index < count; index += 1) {
      const text = texts[index] ?? "";
      if (!findPageUnderlay(host, index) && text.trim() && readyCore().containsMath(text)) {
        await loadMathOrLog();
        break;
      }
    }
    const pages: InkPrintPageLayers[] = [];
    for (let index = 0; index < count; index += 1) {
      const layer = textPages.current[index] ?? "";
      // The figures are in the page's own text layer, not in the flowed prose.
      // A missing attachment is a figure the page does not draw.
      const figures = await loadInOrder(
        typedCore().inkPageFigures(layer),
        async ({ path, ...geometry }) => ({
          ...geometry,
          url: await blobToDataUrl(await fetchBlob(path)),
        }),
      );
      // The current page's ink comes from the worker, which runs ahead of its
      // save; every other page's from its saved strokes. Asked transparent:
      // the print document lays its own paper down.
      let ink: Blob | null;
      if (index === pageIndex) {
        ink = await requestExport(PNG_EXPORT_SCALE, true);
      } else {
        const path = typedCore().inkPageBackground(layer);
        let background: Blob | null = null;
        if (path) {
          try {
            background = await fetchBlob(path);
          } catch {
            // A missing attachment is a page without its background.
          }
        }
        ink = await savedPageInk(savedStrokes.get(index) ?? [], background, pageSize, palette);
      }
      pages.push({
        underlayHtml: pageUnderlayHtml(host, index, texts[index] ?? "", renderMarkdownPlain),
        figures,
        inkUrl: ink ? await blobToDataUrl(ink) : undefined,
        paper,
      });
    }
    const title = noteId;
    setPrintDoc({
      title,
      html: inkPrintPagesDocument(
        {
          title,
          pageSize,
          scale,
          underlay: {
            padX: INK_UNDERLAY.padX(scale),
            padY: INK_UNDERLAY.padY(scale),
            fontSize: INK_UNDERLAY.fontSize(scale),
            lineHeight: INK_UNDERLAY.lineHeight,
          },
          rule: inkSheetRuleStyle(scale),
          styleSheets: documentStyleSheets(document),
        },
        pages,
      ),
    });
  }, [
    fetchBlob,
    noteId,
    pageCount,
    pageIndex,
    pageSize,
    pageTexts,
    palette,
    paper,
    requestExport,
    root,
    savedStrokes,
    scale,
    textPages,
  ]);

  /**
   * The page as SVG: the strokes themselves, not a picture of them.
   *
   * The model comes from the worker (it owns the geometry) and the background
   * comes from the vault, as a data URL — a blob URL would not survive the file
   * being saved and opened again.
   */
  const onExportSvg = useCallback(async () => {
    const page = await requestModel();
    const path = typedCore().inkPageBackground(textPages.current[pageIndex] ?? "");
    let backgroundDataUrl: string | null = null;
    if (path) {
      try {
        backgroundDataUrl = await blobToDataUrl(await fetchBlob(path));
      } catch {
        // A missing attachment is a page without its background, which is what
        // the export draws: the strokes are the page's own record.
      }
    }
    // The figures, embedded the same way: the page as it looks, not the page
    // as the worker knows it.
    // A missing figure is the same as a missing background: the strokes are
    // the page's own record.
    const figures: InkSvgFigure[] = await loadInOrder(
      typedCore().inkPageFigures(textPages.current[pageIndex] ?? ""),
      async (figure) => ({
        ...figure,
        dataUrl: await blobToDataUrl(await fetchBlob(figure.path)),
      }),
    );
    const svg = readyCore().inkPageSvg(toWasmInkPage(page), {
      palette,
      backgroundDataUrl,
      figures,
      title: `${noteId} — page ${pageIndex + 1}`,
    });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${fileBase}.svg`);
  }, [fetchBlob, fileBase, noteId, pageIndex, palette, requestModel, textPages]);

  return { onExportPng, onPrint, onExportSvg, printDoc, closePrint };
}
