"use client";

/**
 * Undo and redo for every local mark on a paper: strokes, highlights, notes,
 * pictures. Deletes ask no question, so Ctrl+Z is how a slip comes back.
 *
 * The stack lives in core (`ink-undo.ts`); this hook records each write and
 * replays the inverse through the same writes. A recreated mark keeps its id,
 * so pins and links to it survive an undo.
 */

import { useCallback, useRef, useState } from "react";
import {
  EMPTY_INK_UNDO,
  pushInkUndo,
  refreshInkUndoAnnotation,
  renameInkUndoId,
  takeInkRedo,
  takeInkUndo,
  type InkUndoEntry,
  type InkUndoState,
  type NewReaderAnnotation,
  type ReaderAnnotation,
} from "@weaveforge/core";

import type { AnnotationActions } from "./use-annotation-actions";

type StrokeWrites = Pick<AnnotationActions, "persistDraft" | "removeLocal" | "saveAnchor">;

export interface InkUndo extends StrokeWrites {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** Forget everything, e.g. when the paper changes. */
  reset: () => void;
}

/** The draft that recreates `ann` byte-for-byte, id included. */
function draftFromAnnotation(ann: ReaderAnnotation): NewReaderAnnotation {
  return {
    id: ann.id,
    type: ann.type,
    color: ann.color,
    ...(ann.text ? { text: ann.text } : {}),
    ...(ann.comment ? { comment: ann.comment } : {}),
    ...(ann.tags?.length ? { tags: ann.tags } : {}),
    anchor: ann.anchor,
    ...(ann.sortIndex ? { sortIndex: ann.sortIndex } : {}),
    pageIndex: ann.anchor.zoteroPosition?.pageIndex ?? 0,
  };
}

/**
 * Wrap the reader's writes so stroke writes are recorded, and expose undo and
 * redo over the record.
 *
 * `annotations` is the reader's current list; it is read when a stroke is
 * removed (to snapshot it) and when an anchor step is replayed (to find the
 * row the step names). Both are read through a ref so the returned writes
 * keep their identity across renders — `usePagePointer` holds them in
 * callbacks that must not be recreated on every annotation change.
 */
export function useInkUndo(
  actions: StrokeWrites,
  annotations: readonly ReaderAnnotation[],
): InkUndo {
  // The stack is a ref so a step can pop it synchronously and then await the
  // write; the counter re-renders whoever shows the undo/redo buttons.
  const stack = useRef<InkUndoState>(EMPTY_INK_UNDO);
  const [, bump] = useState(0);
  const setState = useCallback((update: (s: InkUndoState) => InkUndoState) => {
    stack.current = update(stack.current);
    bump((n) => n + 1);
  }, []);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  // Undo and redo are async; a second Ctrl+Z before the first lands would
  // pop the wrong step. One at a time.
  const busy = useRef(false);

  const persistDraft = useCallback(
    async (draft: NewReaderAnnotation) => {
      const created = await actionsRef.current.persistDraft(draft);
      if (created) {
        setState((s) => pushInkUndo(s, { kind: "create", annotation: created }));
      }
      return created;
    },
    [setState],
  );

  const removeLocal = useCallback(
    async (id: string) => {
      const ann = annotationsRef.current.find((a) => a.id === id);
      await actionsRef.current.removeLocal(id);
      if (ann) {
        setState((s) => pushInkUndo(s, { kind: "remove", annotation: ann }));
      }
    },
    [setState],
  );

  const saveAnchor = useCallback(
    async (ann: ReaderAnnotation, anchor: ReaderAnnotation["anchor"], comment?: string) => {
      await actionsRef.current.saveAnchor(ann, anchor, comment);
      const after = { ...ann, anchor };
      setState((s) =>
        refreshInkUndoAnnotation(
          pushInkUndo(s, { kind: "anchor", id: ann.id, before: ann.anchor, after: anchor }),
          after,
        ),
      );
    },
    [setState],
  );

  /** Apply one step's inverse (undo) or the step itself (redo) through the raw writes. */
  const apply = useCallback(async (entry: InkUndoEntry, direction: "undo" | "redo") => {
    const raw = actionsRef.current;
    const recreate = async (ann: ReaderAnnotation) => {
      const created = await raw.persistDraft(draftFromAnnotation(ann));
      // Same id unless the store refused it; then the stack follows the new one.
      if (created && created.id !== ann.id) setState((s) => renameInkUndoId(s, ann.id, created.id));
    };
    const remove = (ann: ReaderAnnotation) => raw.removeLocal(ann.id);
    switch (entry.kind) {
      case "create":
        return direction === "undo" ? remove(entry.annotation) : recreate(entry.annotation);
      case "remove":
        return direction === "undo" ? recreate(entry.annotation) : remove(entry.annotation);
      case "anchor": {
        const target = annotationsRef.current.find((a) => a.id === entry.id);
        if (!target) return;
        const anchor = direction === "undo" ? entry.before : entry.after;
        await raw.saveAnchor(target, anchor);
        setState((s) => refreshInkUndoAnnotation(s, { ...target, anchor }));
        return;
      }
    }
  }, [setState]);

  const step = useCallback(
    async (direction: "undo" | "redo") => {
      if (busy.current) return;
      const taken =
        direction === "undo" ? takeInkUndo(stack.current) : takeInkRedo(stack.current);
      if (!taken) return;
      setState(() => taken.state);
      busy.current = true;
      try {
        await apply(taken.entry, direction);
      } finally {
        busy.current = false;
      }
    },
    [apply, setState],
  );

  const reset = useCallback(() => setState(() => EMPTY_INK_UNDO), [setState]);

  return {
    persistDraft,
    removeLocal,
    saveAnchor,
    canUndo: stack.current.undo.length > 0,
    canRedo: stack.current.redo.length > 0,
    undo: useCallback(() => step("undo"), [step]),
    redo: useCallback(() => step("redo"), [step]),
    reset,
  };
}
