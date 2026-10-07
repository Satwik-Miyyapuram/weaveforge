"use client";

import { memo, useMemo, useRef } from "react";
import {
  pdfRectToScreenBox,
  type FigureGeometry,
  type FigureOrderStep,
  type ReaderAnnotation,
} from "@weaveforge/core";
import {
  INK_SELECTION_HALO_PX,
  InkFigureEditor,
  InkFigures,
  InkStrokes,
} from "@/features/ink";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";
import { projectPageAnnotationGeometry } from "../application/project-annotation-geometry";
import { pagePictures } from "../application/reader-picture";
import type { PictureEdit } from "./pdf-reader/use-pdf-pictures";

interface AnnotationOverlayProps {
  annotations: ReaderAnnotation[];
  pageNumber: number;
  /** Current PDF content hash for rect trust. */
  contentHash?: string;
  scale: number;
  rotation: number;
  pageHeight: number;
  pageWidth: number;
  selectedId: string | null;
  /** The ink marks a lasso has picked up, by annotation id. */
  inkSelectedIds?: readonly string[];
  /**
   * A highlight was tapped.
   *
   * Only the highlight boxes answer to this. Ink does not: it is picked up with
   * the lasso, by geometry, and never has to be a target on the page — see the
   * note on this component.
   */
  onSelect?: (id: string) => void;
  /** Reads a placed picture's file; pictures are drawn only when given. Keep it stable. */
  fetchPicture?: (path: string) => Promise<Blob>;
  /**
   * The picture on this page whose editor is open, with its unwritten
   * placement. Given to the one page it is on, so the others stay memoised.
   */
  pictureEdit?: PictureEdit | null;
  onPictureChange?: (next: Pick<FigureGeometry, "x" | "y" | "w" | "h" | "crop">) => void;
  onPictureReorder?: (step: FigureOrderStep) => void;
  onPictureRemove?: () => void;
  onPictureClose?: () => void;
  /** The text box being typed into on this page; given to that one page only. */
  textEdit?: TextEdit | null;
  onTextCommit?: (text: string) => void;
  onTextCancel?: () => void;
}

/** A text box open for typing: an existing one by id, or a new one (id null). */
export interface TextEdit {
  id: string | null;
  /** PDF user-space rect, bottom-left origin. */
  rect: [number, number, number, number];
  text: string;
}

const NO_PICTURES = async () => null;

/**
 * Paint page-local annotation geometry. All coordinate maths lives in
 * `projectPageAnnotationGeometry`; this component is markup only.
 *
 * There are two kinds of mark here and they are drawn by two different things,
 * deliberately. A **highlight** is a rectangle of text and stays a DOM box:
 * it sits under the page's own words, takes their colour, and is what a tap
 * lands on. **Ink** is drawn by the ink note's renderer (`InkStrokes`), so a
 * stroke written on a paper is the same path, cap, join and highlighter tint as
 * one written on a note — the reader owns no stroke renderer of its own.
 *
 * The ink is paint and nothing else: it takes no pointer. Marks are picked up
 * with the lasso, which works by geometry (`inkAnnotationsAt`) rather than by
 * hit-testing the DOM, so a stroke never has to be a target — and, being no
 * target, it never stands between the pen and the words underneath it.
 */
function AnnotationOverlayInner({
  annotations,
  pageNumber,
  contentHash = "",
  scale,
  rotation,
  pageHeight,
  pageWidth,
  selectedId,
  inkSelectedIds,
  onSelect,
  fetchPicture,
  pictureEdit = null,
  onPictureChange,
  onPictureReorder,
  onPictureRemove,
  onPictureClose,
  textEdit = null,
  onTextCommit,
  onTextCancel,
}: AnnotationOverlayProps) {
  // Projection is the reader's per-frame cost: ~1.7 ms for a page holding 100
  // ink annotations, 6.5 ms at 400. Drawing a stroke re-renders this component
  // once per animation frame, and every *other* page's overlay along with it,
  // so without this the whole document is re-projected 60 times a second while
  // the pen is down. Memoised on the inputs the geometry actually depends on.
  const { boxes, strokes } = useMemo(
    () =>
      projectPageAnnotationGeometry({
        annotations,
        pageNumber,
        scale,
        pageHeight,
        pageWidth,
        rotation,
        contentHash,
      }),
    [annotations, pageNumber, scale, pageHeight, pageWidth, rotation, contentHash],
  );

  const ink = useMemo(
    () =>
      strokes.map((s) => ({
        id: s.id,
        points: s.points,
        width: s.width,
        colour: s.color,
        highlighter: s.highlighter,
      })),
    [strokes],
  );

  // Only the pages that carry a picture fetch anything: the list is empty elsewhere.
  const picturePaths = useMemo(
    () => (fetchPicture ? boxes.flatMap((box) => (box.picture ? [box.picture] : [])) : []),
    [boxes, fetchPicture],
  );
  const pictureUrls = useBlobObjectUrls(picturePaths, fetchPicture ?? NO_PICTURES);

  // On an upright page a picture is an ink figure: drawn by the note's own
  // renderer, under the ink, and edited by the note's own editor. A turned
  // page keeps the mark-shaped box below, which knows rotation.
  const upright = rotation % 360 === 0 && Boolean(fetchPicture);
  const placed = useMemo(
    () => (upright ? pagePictures(annotations, pageHeight) : []),
    [annotations, pageHeight, upright],
  );
  const pictures = useMemo(
    () =>
      placed.map((one) =>
        pictureEdit?.preview && one.id === pictureEdit.id
          ? { ...one, figure: { path: one.figure.path, ...pictureEdit.preview } }
          : one,
      ),
    [placed, pictureEdit],
  );
  const figures = useMemo(() => pictures.map((one) => one.figure), [pictures]);
  const activeIndex = pictureEdit ? pictures.findIndex((one) => one.id === pictureEdit.id) : -1;
  const active = activeIndex >= 0 ? pictures[activeIndex] : undefined;

  if (boxes.length === 0 && ink.length === 0 && !textEdit) return null;

  return (
    <>
    <div className="pdf-reader-ann-layer" aria-hidden>
      {figures.length > 0 && (
        <InkFigures
          figures={figures}
          scale={scale}
          imageUrls={pictureUrls}
          activeIndex={activeIndex >= 0 ? activeIndex : null}
        />
      )}
      <InkStrokes
        className="pdf-reader-ann-svg"
        // A highlighter over a PDF page is the reader's own look, not the
        // sheet's: see `InkStrokes.highlighterClassName`.
        highlighterClassName="pdf-reader-ink--highlighter"
        strokes={ink}
        // The list's single selection and the lasso's set are one selection as
        // far as the ink is concerned: both are marks that are picked up.
        selectedIds={
          selectedId ? [...(inkSelectedIds ?? []), selectedId] : inkSelectedIds
        }
        // A picked-up mark wears the note's halo, not a box round it — the box
        // belongs to the highlight rectangles below, which *are* rectangles.
        haloGrow={INK_SELECTION_HALO_PX}
      />
      {boxes.map((box, i) =>
        (box.picture && upright) || (textEdit && box.id === textEdit.id) ? null : box.picture ? (
          <button
            key={`${box.id}-${i}`}
            type="button"
            className={`pdf-reader-picture${selectedId === box.id ? " is-selected" : ""}`}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            onClick={onSelect ? () => onSelect(box.id) : undefined}
          >
            {pictureUrls.get(box.picture) ? <img src={pictureUrls.get(box.picture)} alt="" /> : null}
          </button>
        ) : (
          <button
            key={`${box.id}-${i}`}
            type="button"
            className={`pdf-reader-ann${selectedId === box.id ? " is-selected" : ""}${
              box.underline ? " is-underline" : ""
            }${box.text != null ? " is-text" : ""}`}
            style={{
              left: box.left,
              top: box.top,
              width: Math.max(box.width, 2),
              height: Math.max(box.height, 2),
              background: box.underline || box.text != null ? "transparent" : box.color,
              borderBottom: box.underline ? `2px solid ${box.color}` : undefined,
              borderLeft: box.text != null ? `3px solid ${box.color}` : undefined,
              fontSize: box.text != null ? 11 * scale : undefined,
            }}
            onClick={(event) => {
              if (typeof document !== "undefined") {
                const elements = document.elementsFromPoint(event.clientX, event.clientY);
                const cite = elements
                  .find((el) => el.closest("a.pdf-reader-cite"))
                  ?.closest<HTMLAnchorElement>("a.pdf-reader-cite");
                if (cite) {
                  cite.click();
                  return;
                }
              }
              onSelect?.(box.id);
            }}
          >
            {box.text}
          </button>
        ),
      )}
    </div>
    {textEdit && onTextCommit && (
      <TextBoxEditor
        // A fresh editor per box, so one saved box never blocks the next.
        key={`${textEdit.id ?? "new"}:${textEdit.rect.join()}`}
        edit={textEdit}
        projection={{ pageWidth, pageHeight, scale, rotation }}
        onCommit={onTextCommit}
        onCancel={onTextCancel ?? (() => undefined)}
      />
    )}
    {active && onPictureChange && (
      // The editor's presses are its own: the page row under it would
      // otherwise start a stroke, or close the editor, with the same press.
      <div
        className="pdf-reader-picture-editor"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onPointerCancel={(event) => event.stopPropagation()}
      >
        <InkFigureEditor
          figure={active.figure}
          index={activeIndex}
          count={pictures.length}
          scale={scale}
          pageSize={{ width: pageWidth, height: pageHeight }}
          imageUrl={pictureUrls.get(active.figure.path)}
          onChange={onPictureChange}
          onReorder={onPictureReorder ?? (() => undefined)}
          onRemove={onPictureRemove ?? (() => undefined)}
          onClose={onPictureClose ?? (() => undefined)}
        />
      </div>
    )}
    </>
  );
}

/** Typing straight into the box on the page: Enter or leaving saves, Escape drops. */
function TextBoxEditor({
  edit,
  projection,
  onCommit,
  onCancel,
}: {
  edit: TextEdit;
  projection: { pageWidth: number; pageHeight: number; scale: number; rotation: number };
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  // Enter saves and unmounts, which blurs: without this the box saves twice.
  const done = useRef(false);
  const box = pdfRectToScreenBox(edit.rect, projection);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    if (text == null || text.trim() === "") onCancel();
    else onCommit(text);
  };
  return (
    <textarea
      className="pdf-reader-text-edit"
      aria-label="Text box"
      placeholder="Type here"
      autoFocus
      defaultValue={edit.text}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, fontSize: 11 * projection.scale }}
      // The page row under it would start a new box with the same press.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") finish(null);
        else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finish(event.currentTarget.value);
        }
      }}
    />
  );
}

/**
 * Every page in the document mounts one of these, so a re-render of the reader
 * fans out across the whole file. The props are the page's own geometry and a
 * bucketed annotation array whose identity only changes when that page's
 * annotations do — so a stroke on page 3 leaves pages 1, 2, 4… untouched
 * instead of re-projecting each of them.
 */
export const AnnotationOverlay = memo(AnnotationOverlayInner);
