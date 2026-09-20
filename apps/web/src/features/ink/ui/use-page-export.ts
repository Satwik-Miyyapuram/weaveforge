"use client";

import { useCallback, useState } from "react";
import {
  inkPageBackground,
  inkPageFigures,
  type FigureGeometry,
  type InkPage as InkPageModel,
} from "@weaveforge/core";

import { blobToDataUrl, downloadBlob } from "@/lib/blob-output";
import { renderMarkdownPlain } from "@/components/markdown/markdown";
import { containsMath, loadMathRenderer } from "@/components/markdown/math-renderer";
import {
  documentStyleSheets,
  inkPrintDocument,
  type InkPrintFigure,
} from "../application/ink-print";
import { inkPageSvg, type InkSvgFigure } from "../application/ink-svg";
import type { InkPalette } from "../render/ink-palette";
import { INK_UNDERLAY, inkSheetRuleStyle } from "./ink-sheet-underlay";

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
  /** The current page's flowed text, which the print sets under the ink. */
  pageText: { readonly current: string };
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
    // The figures, then the ink over them: the sheet's own order.
    for (const figure of figures) {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(await fetchBlob(figure.path));
      } catch {
        continue; // a missing attachment is a figure the page does not draw
      }
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
    pageText,
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
    const figures = inkPageFigures(textPages.current[pageIndex] ?? "");
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
   * The page for paper: every layer of the sheet, not the raster alone.
   *
   * The text is the underlay's own markup where the sheet is on screen (so a
   * Mermaid diagram already upgraded prints as the diagram), or the markdown
   * rendered afresh where it is not; the figures and the ink are embedded as
   * data URLs so the document needs no vault. The ink is asked for
   * transparent, which still carries the page's background image: only the
   * white is left out, and the print document lays its own paper down.
   */
  const onPrint = useCallback(async () => {
    const text = pageText.current;
    // `data-page` is the 0-based index; the live page and its static slot
    // both carry it, and the live one is the one whose fences have upgraded.
    const live =
      document.querySelector<HTMLElement>(
        `.ink-page-live[data-page="${pageIndex}"] .ink-sheet-text-underlay`,
      ) ??
      document.querySelector<HTMLElement>(
        `.ink-page[data-page="${pageIndex}"] .ink-sheet-text-underlay`,
      );
    // The live underlay is preferred, and it has already waited for KaTeX. The
    // fallback renders the markdown afresh for a page that is not on screen, and
    // maths there would come out as the placeholder unless the renderer is in
    // memory — so it is fetched first when the text has any. This callback is
    // already async, so waiting costs nothing visible.
    if (!live && text.trim() && containsMath(text)) {
      await loadMathRenderer().catch(() => undefined);
    }
    const underlayHtml = live?.innerHTML ?? (text.trim() ? renderMarkdownPlain(text) : "");
    // The figures are in the page's own text layer, not in the flowed prose,
    // which is the text with its figure lines already taken out.
    const figures: InkPrintFigure[] = [];
    for (const figure of inkPageFigures(textPages.current[pageIndex] ?? "")) {
      try {
        const { path, ...geometry } = figure;
        figures.push({ ...geometry, url: await blobToDataUrl(await fetchBlob(path)) });
      } catch {
        // A missing attachment is a figure the page does not draw.
      }
    }
    const ink = await requestExport(PNG_EXPORT_SCALE, true);
    const title = `${noteId} — page ${pageIndex + 1}`;
    setPrintDoc({
      title,
      html: inkPrintDocument({
        title,
        pageSize,
        scale,
        paper,
        underlayHtml,
        underlay: {
          padX: INK_UNDERLAY.padX(scale),
          padY: INK_UNDERLAY.padY(scale),
          fontSize: INK_UNDERLAY.fontSize(scale),
          lineHeight: INK_UNDERLAY.lineHeight,
        },
        rule: inkSheetRuleStyle(scale),
        figures,
        inkUrl: ink ? await blobToDataUrl(ink) : null,
        styleSheets: documentStyleSheets(document),
      }),
    });
  }, [fetchBlob, noteId, pageIndex, pageSize, pageText, paper, requestExport, scale, textPages]);

  /**
   * The page as SVG: the strokes themselves, not a picture of them.
   *
   * The model comes from the worker (it owns the geometry) and the background
   * comes from the vault, as a data URL — a blob URL would not survive the file
   * being saved and opened again.
   */
  const onExportSvg = useCallback(async () => {
    const page = await requestModel();
    const path = inkPageBackground(textPages.current[pageIndex] ?? "");
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
    const figures: InkSvgFigure[] = [];
    for (const figure of inkPageFigures(textPages.current[pageIndex] ?? "")) {
      try {
        figures.push({
          ...figure,
          dataUrl: await blobToDataUrl(await fetchBlob(figure.path)),
        });
      } catch {
        // A missing figure is the same as a missing background: the strokes
        // are the page's own record.
      }
    }
    const svg = inkPageSvg(page, {
      palette,
      backgroundDataUrl,
      figures,
      title: `${noteId} — page ${pageIndex + 1}`,
    });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${fileBase}.svg`);
  }, [fetchBlob, fileBase, noteId, pageIndex, palette, requestModel, textPages]);

  return { onExportPng, onPrint, onExportSvg, printDoc, closePrint };
}
