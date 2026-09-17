"use client";

/**
 * Page media: the images a page holds, in the two ways it holds them.
 *
 * A page's *background* is the page: a PDF page raster or a photo laid on the
 * whole sheet, named on the page's first text-layer line and mirrored in the
 * chunk header (§4.8). A page's *figures* are content on it: any number of
 * placed images, moved and resized by hand (§figure). Both arrive by the same
 * three doors — the bar's buttons, a drop on the sheet, a paste — and both
 * upload through the vault's attachments, which is what makes the body's
 * attachment index their name.
 *
 * The flows are async in a way a callback has to survive: an upload resolves
 * after the page it was for may have been left, so every write asks the live
 * page index rather than closing over its own.
 */

import { useCallback, useEffect, useState } from "react";
import {
  INK_A4_WIDTH,
  INK_A4_HEIGHT,
  blankInkPage,
  clampInkPageSize,
  encodeInkChunk,
  inkAttachmentIndex,
  inkPageBackground,
  joinInkTextLayer,
  newInkChunkId,
  withInkPageBackground,
  writeInkNoteBody,
  type FigureGeometry,
  type InkNoteMeta,
} from "@weaveforge/core";

import { availableInkChunkCodec } from "../application/ink-chunk-codec";
import type { InkStoredPage } from "../application/ink-chunk-store";
import { pdfPageCount } from "../application/pdf-page-raster";
import {
  figureImageFromFile,
  imageFileFromClipboard,
  imageSize,
  isPageSource,
  isPdf,
  pageBackgroundFromFile,
  pageChunkWithBackground,
} from "../application/page-background";
import { figureBoxForAspect } from "./ink-figures";

/** How a page's media gets written; the host owns the sidecar and the saves. */
export interface InkPageMediaDeps {
  noteId: string;
  /** The sidecar: a page's chunk is written here. */
  chunks: {
    write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void>;
  };
  /** The vault's attachments, where every image is uploaded. */
  assets: {
    upload(ownerId: string, blob: Blob, ext: string): Promise<string>;
    fetchBlob(path: string): Promise<Blob>;
  };
  /** The pages, as the host holds them; mutated by an inserted page. */
  pagesRef: { current: InkStoredPage[] | null };
  /** The note's header, for the pages and the paper an inserted page takes. */
  metaRef: { current: InkNoteMeta };
  /** The pages' text layers, where a background or a figure is named. */
  textPagesRef: { current: string[] };
  /** The live page index: a flow may finish on another page than it began. */
  pageIndexRef: { current: number };
  /** The current page's size, for a figure's first box. */
  pageSize: { width: number; height: number };
  /** The whole body, because the attachment index counts its `vault:` refs. */
  noteBody: () => string;
  /** The body, saved. */
  saveBody: () => Promise<void>;
  /** Flush a pending stroke save before a page change. */
  flushSave: () => void;
  /** The late, coalesced save. */
  scheduleSave: () => void;
  /** The figures on the current page, replaced by an add or a remove. */
  onFiguresChange: (next: readonly FigureGeometry[]) => void;
  figuresRef: { current: readonly FigureGeometry[] };
  /** Where a message for the text column goes. */
  setUnavailable: (message: string | null) => void;
  /** Tell the worker the decoded background bitmap and its attachment index. */
  onBackgroundReady: (image: ImageBitmap, index: number) => void;
  /** Take the worker's background off, after the chunk stopped naming one. */
  onBackgroundCleared: () => void;
  /** A page was appended: the host's page count and page index follow it. */
  onPageAppended: (count: number) => void;
  /**
   * The pane, for the paste door: a paste goes to the focused element and
   * the pane is what takes focus, so a paste is only ours when it did.
   */
  wrapRef: { current: HTMLDivElement | null };
}

/** What the host needs back: the flows' state and their doors. */
export interface InkPageMedia {
  /** True while an upload or a raster is in flight, so the bar can say so. */
  inserting: boolean;
  /** The current page's background attachment, for the bar's two buttons. */
  backgroundPath: string | null;
  setBackgroundPath: (path: string | null) => void;
  /** A question the picker is asking, if it is asking one. */
  pageAsk: { count: number; resolve: (pages: number[] | null) => void } | null;
  answerPdfPages: (pages: number[] | null) => void;
  onSetPageBackground: (file: File, targetPageIndex?: number) => Promise<void>;
  onRemovePageBackground: (targetPageIndex?: number) => Promise<void>;
  onAddFigure: (file: File, at?: { x: number; y: number }) => Promise<void>;
  onInsertPage: (file: File) => Promise<void>;
}

export function useInkPageMedia(deps: InkPageMediaDeps): InkPageMedia {
  const [inserting, setInserting] = useState(false);
  const [backgroundPath, setBackgroundPath] = useState<string | null>(null);
  const [pageAsk, setPageAsk] = useState<{
    count: number;
    resolve: (pages: number[] | null) => void;
  } | null>(null);

  /**
   * Write a page's chunk with its background index, strokes and lines kept
   * (§4.8). The text layer says which attachment a page shows; the chunk
   * header mirrors it for a reader that has only the sidecar.
   */
  const writePageBackgroundChunk = useCallback(
    async (targetIndex: number, background: number) => {
      const pages = deps.pagesRef.current;
      const target = pages?.[targetIndex];
      if (!pages || !target) return;
      const bytes = await pageChunkWithBackground(target.chunk, {
        background,
        paper: target.paper,
        // A page with no chunk yet is a blank one on this sheet; the sheet in
        // front of the user is the honest answer for the page in front of them.
        size:
          targetIndex === deps.pageIndexRef.current
            ? { width: deps.pageSize.width, height: deps.pageSize.height }
            : undefined,
        codec: availableInkChunkCodec(),
      });
      await deps.chunks.write(deps.noteId, target.chunkId, bytes);
      target.chunk = bytes;
    },
    [deps.chunks, deps.noteId, deps.pageSize.height, deps.pageSize.width, deps.pageIndexRef, deps.pagesRef],
  );

  /**
   * Which pages of a multi-page PDF to use, as a promise. The app's own
   * dialog, not `window.prompt`: the system one ignores the theme and covers
   * the page it is asking about on a phone. The answer is a list — "all", or
   * "1,3-5" — so a whole paper can come over as its own pages in one ask;
   * `null` is the dismissal, which every caller treats as "do nothing".
   */
  const askPdfPages = useCallback(
    (count: number) =>
      new Promise<number[] | null>((resolve) => setPageAsk({ count, resolve })),
    [],
  );
  /** The answer to the picker's question, and the code waiting on it. */
  const answerPdfPages = useCallback(
    (pages: number[] | null) => {
      const ask = pageAsk;
      setPageAsk(null);
      ask?.resolve(pages);
    },
    [pageAsk],
  );

  /**
   * Put an image on a page (§4.8): the page in front of the user unless one
   * is named. The file is laid on the A4 sheet, uploaded as this note's
   * attachment, named on that page's first text-layer line, and its index
   * written into the page's chunk header. An image on a page that already has
   * one replaces it, which is why the bar asks before calling this.
   */
  const onSetPageBackground = useCallback(
    async (file: File, targetPageIndex?: number) => {
      const pages = deps.pagesRef.current;
      if (!pages || inserting) return;
      if (!isPageSource(file)) {
        deps.setUnavailable(`${file.name} is not a PDF or an image.`);
        return;
      }
      const target = Math.max(
        0,
        Math.min(targetPageIndex ?? deps.pageIndexRef.current, pages.length - 1),
      );
      setInserting(true);
      try {
        let number = 1;
        if (isPdf(file)) {
          const count = await pdfPageCount(await file.arrayBuffer());
          if (count > 1) {
            const answer = await askPdfPages(count);
            // A page image is one page: the first of what was asked, because a
            // caller that answered a list here was reaching for "insert pages",
            // not "add an image" — and a dismissal stops the flow.
            if (answer === null || answer.length === 0) return;
            number = answer[0]!;
          }
        }
        const png = await pageBackgroundFromFile(file, number);
        const path = await deps.assets.upload(deps.noteId, png, "png");
        // The text layer first: the body is what the attachment index counts.
        deps.textPagesRef.current = deps.textPagesRef.current.map((text, index) =>
          index === target ? withInkPageBackground(text, path) : text,
        );
        const background = inkAttachmentIndex(deps.noteBody(), path);
        await writePageBackgroundChunk(target, background);
        // The page the work was for is still the one on screen, whichever page
        // the user was on when the click started: a page made for a new image
        // is being looked at by now and has to be told, because nothing else
        // will — the page-change effect read this page's text layer before this
        // write got to it, so it saw a page with no image on it.
        if (target === deps.pageIndexRef.current) {
          // The worker draws it now, and is told the index so the next save —
          // the first stroke over the image — writes the same mirror back.
          const image = await createImageBitmap(png);
          deps.onBackgroundReady(image, background);
          setBackgroundPath(path);
        }
        deps.scheduleSave();
      } catch (error) {
        deps.setUnavailable(
          `The image could not be added: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setInserting(false);
      }
    },
    [askPdfPages, deps, inserting, writePageBackgroundChunk],
  );

  /** Take a page's image off, in the text layer and in the chunk (§4.8). */
  const onRemovePageBackground = useCallback(
    async (targetPageIndex?: number) => {
      const pages = deps.pagesRef.current;
      if (!pages) return;
      const target = Math.max(
        0,
        Math.min(targetPageIndex ?? deps.pageIndexRef.current, pages.length - 1),
      );
      if (!inkPageBackground(deps.textPagesRef.current[target] ?? "")) return;
      deps.textPagesRef.current = deps.textPagesRef.current.map((text, index) =>
        index === target ? withInkPageBackground(text, null) : text,
      );
      await writePageBackgroundChunk(target, 0);
      // Only if the reader is still on that page: the chunk write above is an
      // await, so the page losing its image may be behind them by now.
      if (target === deps.pageIndexRef.current) {
        deps.onBackgroundCleared();
        setBackgroundPath(null);
      }
      deps.scheduleSave();
    },
    [deps, writePageBackgroundChunk],
  );

  /**
   * Put an image on the page as a figure: a placed box, not the page's
   * background. Any number may sit on one page — that is the point — and the
   * first box is the image's own aspect at half the page's width, centred:
   * the drop or the paste lands wherever the pointer was, and the bar's
   * button lands in the middle. A PDF still goes to the background, because a
   * PDF's raster *is* a page; an image is content on one.
   */
  const onAddFigure = useCallback(
    async (file: File, at?: { x: number; y: number }) => {
      if (isPdf(file)) {
        void onSetPageBackground(file);
        return;
      }
      if (!isPageSource(file)) {
        deps.setUnavailable(`${file.name} is not a PDF or an image.`);
        return;
      }
      setInserting(true);
      try {
        const [attachment, size] = await Promise.all([
          figureImageFromFile(file),
          imageSize(file),
        ]);
        // The extension follows the bytes: WebP where the browser made one,
        // PNG where it answered with one, never a name the bytes contradict.
        const path = await deps.assets.upload(
          deps.noteId,
          attachment.blob,
          attachment.ext,
        );
        const box = figureBoxForAspect(
          size.width / Math.max(1, size.height),
          at ?? { x: deps.pageSize.width / 2, y: deps.pageSize.height / 2 },
          deps.pageSize,
        );
        deps.onFiguresChange([...deps.figuresRef.current, { ...box, path }]);
      } catch (error) {
        deps.setUnavailable(
          `The image could not be added: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setInserting(false);
      }
    },
    [deps, onSetPageBackground],
  );

  /**
   * A pasted screenshot (§4.8).
   *
   * The listener is on the window because a `paste` goes to the focused element
   * and a canvas does not take focus; the wrap is what takes it, on a
   * pointer-down, which is also what keeps a paste aimed at the note editor
   * away from here — text pasted there carries no image item, and the active
   * element is not inside this pane. A field inside this pane — a correction in
   * the text column — is the user pasting *text*, and keeps its own paste.
   *
   * An image pastes as a figure: a pasted screenshot is content on the page,
   * not the page, and a page may already have figures worth keeping.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      const wrap = deps.wrapRef.current;
      if (!wrap || !wrap.contains(document.activeElement)) return;
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void onAddFigure(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // `deps` is the host's object for this hook; `onAddFigure` is the flow above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, onAddFigure]);

  /**
   * A PDF's pages or an image as new pages (§4.8): each one laid on an A4
   * sheet (a PDF page rasterised with the reader's pdf.js), uploaded to the
   * vault as this note's attachment, named on that page's first text-layer
   * line, mirrored in its chunk header as the attachment index. Every page
   * becomes a page of its own, in the order the pages were asked for — "all",
   * or a list like "1,3-5" — so a whole paper comes over in one ask. Each
   * page is A4 whatever the source's shape, so the note prints as drawn.
   */
  const onInsertPage = useCallback(
    async (file: File) => {
      const pages = deps.pagesRef.current;
      if (!pages || inserting) return;
      if (!isPageSource(file)) {
        deps.setUnavailable(`${file.name} is not a PDF or an image.`);
        return;
      }
      setInserting(true);
      try {
        let numbers = [1];
        if (isPdf(file)) {
          const count = await pdfPageCount(await file.arrayBuffer());
          if (count > 1) {
            const answer = await askPdfPages(count);
            if (answer === null || answer.length === 0) return;
            numbers = answer;
          }
        }
        // One page per import: rasterised, uploaded, its own chunk and its own
        // first text-layer line. The attachment index counts the body, so the
        // text layer grows before each index is read — which is what makes a
        // later page's index different from an earlier one's.
        const size = clampInkPageSize(INK_A4_WIDTH, INK_A4_HEIGHT);
        for (const number of numbers) {
          const png = await pageBackgroundFromFile(file, number);
          const path = await deps.assets.upload(deps.noteId, png, "png");
          const text = withInkPageBackground("", path);
          const nextTextPages = [...deps.textPagesRef.current, text];
          const body = writeInkNoteBody(
            deps.metaRef.current,
            joinInkTextLayer(nextTextPages),
          );
          const chunkId = newInkChunkId();
          const chunk = await encodeInkChunk({
            ...blankInkPage(deps.metaRef.current.paper),
            width: size.width,
            height: size.height,
            background: inkAttachmentIndex(body, path),
          });
          await deps.chunks.write(deps.noteId, chunkId, chunk);
          deps.flushSave();
          pages.push({ chunkId, chunk, paper: deps.metaRef.current.paper });
          deps.textPagesRef.current = nextTextPages;
          deps.onPageAppended(pages.length);
          deps.saveBody();
        }
      } catch (error) {
        deps.setUnavailable(
          `The page could not be inserted: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setInserting(false);
      }
    },
    [askPdfPages, deps, inserting],
  );

  return {
    inserting,
    backgroundPath,
    setBackgroundPath,
    pageAsk,
    answerPdfPages,
    onSetPageBackground,
    onRemovePageBackground,
    onAddFigure,
    onInsertPage,
  };
}
