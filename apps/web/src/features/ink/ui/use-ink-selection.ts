"use client";

import { useCallback } from "react";
import type { InkPage as InkPageModel } from "@weaveforge/core";
import type { InkWorkerMessage } from "../application/capture-protocol";
import { selectedText } from "./ink-page-math";

export interface UseInkSelectionOptions {
  send: (message: InkWorkerMessage) => void;
  scheduleSave: () => void;
  selection: readonly number[];
  setSelection: React.Dispatch<React.SetStateAction<number[]>>;
  setSelectionBounds: React.Dispatch<React.SetStateAction<readonly [number, number, number, number] | null>>;
  requestModel: () => Promise<InkPageModel>;
}

export function useInkSelection({
  send,
  scheduleSave,
  selection,
  setSelection,
  setSelectionBounds,
  requestModel,
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

  return {
    onLasso,
    onMoveSelection,
    onDragSelection,
    onDeleteSelection,
    onCopyAsText,
  };
}
