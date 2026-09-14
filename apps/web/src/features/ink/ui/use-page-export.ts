"use client";

import { useCallback } from "react";
import { inkPageBackground, type InkPage as InkPageModel } from "@weaveforge/core";

import { blobToDataUrl, downloadBlob, printBlob } from "@/lib/blob-output";
import { inkPageSvg } from "../application/ink-svg";
import type { InkPalette } from "../render/ink-palette";

/**
 * Pixels per 0.1 mm unit in an exported or printed page.
 *
 * 2 is 508 dpi on A4 — enough that a printed page has no visible raster, and
 * what the PNG export has always used. The print path spends the same raster
 * rather than the DOM, so paper and file match stroke for stroke.
 */
export const PNG_EXPORT_SCALE = 2;

/** What the three exports need from the editor; the host owns all of it. */
export interface PageExportDeps {
  /** The worker's raster of the current page, or `null` when it has none. */
  requestExport: (scale?: number) => Promise<Blob | null>;
  /** The worker's strokes for the current page, for the vector export. */
  requestModel: () => Promise<InkPageModel>;
  /** The note's id, which names the file. */
  noteId: string;
  /** 0-based, so the file says `page-1`. */
  pageIndex: number;
  /** The pages' text layers, where a page's background attachment is named. */
  textPages: { readonly current: string[] };
  /** The ink palette the SVG paints its strokes with. */
  palette: InkPalette;
  /** The vault, for the background bytes a vector export embeds. */
  fetchBlob: (path: string) => Promise<Blob>;
}

/**
 * Getting the current page out of the editor: the print dialog, a full-page
 * PNG, and the page as vector SVG.
 *
 * Out of the host because none of it is about the drawing surface — it is three
 * readers of state the host already holds, and each one ends in a file rather
 * than in the pane. The two that produce pixels go through the worker's raster
 * rather than through the DOM, because what the user sees is a *window* onto the
 * sheet — the canvas is the size of the viewport, not the page (§6.2.14) — so
 * printing the screen would crop the page to whatever happened to be scrolled
 * into view.
 */
export function usePageExport(deps: PageExportDeps) {
  const { requestExport, requestModel, noteId, pageIndex, textPages, palette, fetchBlob } =
    deps;
  const fileBase = `${noteId}-page-${pageIndex + 1}`;

  const onExportPng = useCallback(async () => {
    const png = await requestExport(PNG_EXPORT_SCALE);
    if (!png) return;
    downloadBlob(png, `${fileBase}.png`);
  }, [fileBase, requestExport]);

  const onPrint = useCallback(async () => {
    const png = await requestExport(PNG_EXPORT_SCALE);
    if (!png) return;
    printBlob(png, fileBase, `${noteId} — page ${pageIndex + 1}`);
  }, [fileBase, noteId, pageIndex, requestExport]);

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
    const svg = inkPageSvg(page, {
      palette,
      backgroundDataUrl,
      title: `${noteId} — page ${pageIndex + 1}`,
    });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${fileBase}.svg`);
  }, [fetchBlob, fileBase, noteId, pageIndex, palette, requestModel, textPages]);

  return { onExportPng, onPrint, onExportSvg };
}
