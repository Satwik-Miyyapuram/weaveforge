"use client";

/**
 * Undo and redo for pen strokes, wired over the reader's annotation writes.
 *
 * The stack itself lives in core (`ink-undo.ts`); this hook records each
 * stroke write into it and replays the inverse through the same writes, so an
 * undone stroke leaves storage exactly as if it had never been drawn. Only ink
 * and highlighter strokes are tracked — highlights and notes have their own
 * flows and their own confirmations, and a Ctrl+Z that silently deleted a
 * paragraph's worth of comment would be worse than no undo at all.
 *
 * Recreating a removed stroke gives it a new id, so after every recreate the
 * stack is told the new id (`renameInkUndoId`); the same stroke may be undone
 * and redone any number of times without the stack losing track of it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

function isStroke(ann: Pick<ReaderAnnotation, "type">): boolean {
  return ann.type === "ink";
}

/** The draft that would recreate `ann` byte-for-byte, save its id. */
function draftFromAnnotation(ann: ReaderAnnotation): NewReaderAnnotation {
  return {
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
  enabled: boolean,
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
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Undo and redo are async; a second Ctrl+Z before the first lands would
  // pop the wrong step. One at a time.
  const busy = useRef(false);

  const persistDraft = useCallback(
    async (draft: NewReaderAnnotation) => {
      const created = await actionsRef.current.persistDraft(draft);
      if (created && enabledRef.current && isStroke(created)) {
        setState((s) => pushInkUndo(s, { kind: "create", annotation: created }));
      }
      return created;
    },
    [setState],
  );

  const removeLocal = useCallback(
    async (id: string, options?: { confirm?: boolean }) => {
      const ann = annotationsRef.current.find((a) => a.id === id);
      await actionsRef.current.removeLocal(id, options);
      if (ann && enabledRef.current && isStroke(ann)) {
        setState((s) => pushInkUndo(s, { kind: "remove", annotation: ann }));
      }
    },
    [setState],
  );

  const saveAnchor = useCallback(
    async (ann: ReaderAnnotation, anchor: ReaderAnnotation["anchor"]) => {
      await actionsRef.current.saveAnchor(ann, anchor);
      if (enabledRef.current && isStroke(ann)) {
        const after = { ...ann, anchor };
        setState((s) =>
          refreshInkUndoAnnotation(
            pushInkUndo(s, { kind: "anchor", id: ann.id, before: ann.anchor, after: anchor }),
            after,
          ),
        );
      }
    },
    [setState],
  );

  /** Apply one step's inverse (undo) or the step itself (redo) through the raw writes. */
  const apply = useCallback(async (entry: InkUndoEntry, direction: "undo" | "redo") => {
    const raw = actionsRef.current;
    const recreate = async (ann: ReaderAnnotation) => {
      const created = await raw.persistDraft(draftFromAnnotation(ann));
      if (created) setState((s) => renameInkUndoId(s, ann.id, created.id));
    };
    const remove = (ann: ReaderAnnotation) => raw.removeLocal(ann.id, { confirm: false });
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
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

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
