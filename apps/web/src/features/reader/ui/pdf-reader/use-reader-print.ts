"use client";

import { useCallback, useState } from "react";
import type { ReaderAnnotation } from "@weaveforge/core";

import { strokePath } from "@/features/ink";
import { layoutMarginNotes } from "../../application/margin-notes";
import { projectPageAnnotationGeometry } from "../../application/project-annotation-geometry";
import {
  readerPrintDocument,
  type ReaderPrintNote,
  type ReaderPrintPage,
} from "../../application/reader-print";
import type { PdfDocument } from "./types";

/**
 * Pixels per PDF point in a printed page: 144 dpi, sharp on paper without
 * holding a hundred megabytes of bitmaps for a long paper.
 */
const PRINT_SCALE = 2;
/** A card's assumed height at print size, for stacking; the sheet fits the rest. */
const PRINT_CARD_HEIGHT = 150;
/** What a highlight box and a highlighter stroke let through, as on screen. */
const HIGHLIGHT_ALPHA = 0.35;
const HIGHLIGHTER_ALPHA = 0.45;

export interface ReaderPrintDeps {
  pdf: PdfDocument | null;
  numPages: number;
  rotation: number;
  contentHash: string;
  title: string;
  annotationsOn: (pageNumber: number) => readonly ReaderAnnotation[];
  fetchPicture: (path: string) => Promise<Blob>;
}

async function pictureBitmap(
  cache: Map<string, Promise<ImageBitmap | null>>,
  path: string,
  fetchPicture: (path: string) => Promise<Blob>,
): Promise<ImageBitmap | null> {
  let hit = cache.get(path);
  if (!hit) {
    hit = fetchPicture(path)
      .then((blob) => createImageBitmap(blob))
      .catch(() => null);
    cache.set(path, hit);
  }
  return hit;
}

/**
 * The reader's print: each page drawn afresh at print size with its marks
 * painted in, then laid on A4 by `readerPrintDocument` — landscape beside its
 * comments, or portrait on its own. The pages are rendered here rather than
 * copied from the screen because only the pages near the view are painted,
 * and at screen size.
 */
export function useReaderPrint(deps: ReaderPrintDeps) {
  const { pdf, numPages, rotation, contentHash, title, annotationsOn, fetchPicture } = deps;
  const [printDoc, setPrintDoc] = useState<{ title: string; html: string } | null>(null);
  const [printing, setPrinting] = useState(false);
  const closePrint = useCallback(() => setPrintDoc(null), []);

  const print = useCallback(
    async (withComments: boolean) => {
      if (!pdf || printing) return;
      setPrinting(true);
      try {
        const pictures = new Map<string, Promise<ImageBitmap | null>>();
        const pages: ReaderPrintPage[] = [];
        for (let n = 1; n <= numPages; n += 1) {
          const pdfPage = await pdf.getPage(n);
          const base = pdfPage.getViewport({ scale: 1, rotation: 0 });
          const viewport = pdfPage.getViewport({ scale: PRINT_SCALE, rotation });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;

          const annotations = annotationsOn(n);
          const projection = {
            pageWidth: base.width,
            pageHeight: base.height,
            scale: PRINT_SCALE,
            rotation,
          };
          const { boxes, strokes } = projectPageAnnotationGeometry({
            annotations,
            pageNumber: n,
            contentHash,
            ...projection,
          });
          for (const box of boxes) {
            if (box.picture) {
              const bitmap = await pictureBitmap(pictures, box.picture, fetchPicture);
              if (!bitmap) continue;
              // `object-fit: contain`, as the page shows it.
              const fit = Math.min(box.width / bitmap.width, box.height / bitmap.height);
              const w = bitmap.width * fit;
              const h = bitmap.height * fit;
              ctx.drawImage(bitmap, box.left + (box.width - w) / 2, box.top + (box.height - h) / 2, w, h);
              continue;
            }
            ctx.save();
            ctx.fillStyle = box.color;
            if (box.underline) {
              ctx.fillRect(box.left, box.top + box.height - 2 * PRINT_SCALE, box.width, 2 * PRINT_SCALE);
            } else {
              ctx.globalAlpha = HIGHLIGHT_ALPHA;
              ctx.globalCompositeOperation = "multiply";
              ctx.fillRect(box.left, box.top, Math.max(box.width, 2), Math.max(box.height, 2));
            }
            ctx.restore();
          }
          for (const stroke of strokes) {
            const d = strokePath(stroke);
            if (!d) continue;
            ctx.save();
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            if (stroke.highlighter) {
              ctx.globalAlpha = HIGHLIGHTER_ALPHA;
              ctx.globalCompositeOperation = "multiply";
            }
            ctx.stroke(new Path2D(d));
            ctx.restore();
          }

          const notes: ReaderPrintNote[] = withComments
            ? layoutMarginNotes(annotations, projection, PRINT_CARD_HEIGHT).map((note) => ({
                top: note.top,
                colour: note.annotation.color,
                quote: note.annotation.text,
                comment: note.annotation.comment,
              }))
            : [];
          pages.push({
            image: canvas.toDataURL("image/jpeg", 0.92),
            width: canvas.width,
            height: canvas.height,
            notes,
          });
          pdfPage.cleanup();
        }
        for (const bitmap of await Promise.all(pictures.values())) bitmap?.close();
        setPrintDoc({ title, html: readerPrintDocument({ title, pages, withComments }) });
      } finally {
        setPrinting(false);
      }
    },
    [annotationsOn, contentHash, fetchPicture, numPages, pdf, printing, rotation, title],
  );

  return { print, printing, printDoc, closePrint };
}
