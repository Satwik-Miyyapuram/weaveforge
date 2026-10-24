"use client";

import { useCallback, useEffect } from "react";
import type { InkPage as InkPageModel } from "@weaveforge/core";
import { isEditableTarget } from "@/lib/editable-target";
import type { InkWorkerMessage } from "../application/capture-protocol";
import { parseStrokeClip, pastedStrokesPlace, strokeClipText } from "../application/stroke-clipboard";
import { selectedText } from "./ink-page-math";
import type { InkSheetInk } from "./use-ink-worker-rpc";

export interface UseInkSelectionOptions {
  send: (message: InkWorkerMessage) => void;
  scheduleSave: () => void;
  selection: readonly number[];
  setSelection: React.Dispatch<React.SetStateAction<number[]>>;
  setSelectionBounds: React.Dispatch<React.SetStateAction<readonly [number, number, number, number] | null>>;
  requestModel: () => Promise<InkPageModel>;
  /** The page's strokes by buffer id, which the selection's indices name. */
  sheetInk: InkSheetInk | null;
  pageSize: { width: number; height: number };
  wrapRef: React.RefObject<HTMLElement | null>;
}

/** A clipboard event the note should answer: focus is in it, not in a text field. */
function forInk(event: ClipboardEvent, wrap: HTMLElement | null): boolean {
  if (isEditableTarget(event.target)) return false;
  return !!wrap && wrap.contains(document.activeElement);
}

export function useInkSelection({
  send,
  scheduleSave,
  selection,
  setSelection,
  setSelectionBounds,
  requestModel,
  sheetInk,
  pageSize,
  wrapRef,
}: UseInkSelectionOptions) {
  const onLasso = useCallback(
    (path: readonly number[]) => {
      send({ type: "lasso", polygon: [...path] });
    },
    [send],
  );

  /** The selection moved by `dx, dy`: the worker translates it, the box follows. */
  const onMoveSelection = useCallback(
    (dx: number, dy: number) => {
      send({ type: "move-selection", dx, dy });
      if (dx === 0 && dy === 0) return;
      setSelectionBounds((b) =>
        b ? [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] : b,
      );
      scheduleSave();
    },
    [scheduleSave, send, setSelectionBounds],
  );

  /** The selection is being dragged: the worker shows it shifted, nothing moves yet. */
  const onDragSelection = useCallback(
    (dx: number, dy: number) => send({ type: "drag-selection", dx, dy }),
    [send],
  );

  const onDeleteSelection = useCallback(() => {
    send({ type: "delete-selection" });
    setSelection([]);
    scheduleSave();
  }, [scheduleSave, send, setSelection]);

  const onCopyAsText = useCallback(async () => {
    const model = await requestModel();
    const text = selectedText(model, selection);
    if (text && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  }, [requestModel, selection]);

  const selectedStrokes = useCallback(
    () =>
      selection
        .map((id) => sheetInk?.strokes[sheetInk.ids.indexOf(id)])
        .filter((s): s is NonNullable<typeof s> => !!s),
    [selection, sheetInk],
  );

  const onCopyStrokes = useCallback(async () => {
    const strokes = selectedStrokes();
    if (strokes.length > 0 && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(strokeClipText(strokes));
    }
  }, [selectedStrokes]);

  // Ctrl+C copies the lassoed strokes; a paste of them lands in whichever note has focus.
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      if (!forInk(event, wrapRef.current)) return;
      const strokes = selectedStrokes();
      if (strokes.length === 0 || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", strokeClipText(strokes));
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!forInk(event, wrapRef.current)) return;
      const strokes = parseStrokeClip(event.clipboardData?.getData("text/plain"));
      if (!strokes) return;
      event.preventDefault();
      send({ type: "add-strokes", strokes: pastedStrokesPlace(strokes, sheetInk?.strokes ?? [], pageSize) });
      scheduleSave();
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [pageSize, scheduleSave, selectedStrokes, send, sheetInk, wrapRef]);

  return {
    onLasso,
    onCopyStrokes,
    onMoveSelection,
    onDragSelection,
    onDeleteSelection,
    onCopyAsText,
  };
}
