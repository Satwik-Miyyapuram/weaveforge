"use client";

/**
 * The page's one undo log (§ink-page-history): strokes, which the worker
 * undoes, and figure edits, which the host puts back. The log follows the
 * worker's stroke count and starts empty on every page, the way the worker's
 * own history does.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { FigureGeometry } from "@weaveforge/core";
import type { PageHistory, PageStep } from "@weaveforge/wasm";

import { readyCore } from "@/lib/rust-core";

export function useInkPageHistory({ depth, pageIndex }: {
  /** How many steps the worker can undo, from its last history report. */
  depth: number;
  pageIndex: number;
}) {
  const [history, setHistory] = useState<PageHistory>(() => readyCore().emptyPageHistory());
  // Read and written synchronously, so two quick undos take two steps.
  const ref = useRef(history);
  const commit = useCallback((next: PageHistory) => {
    if (next === ref.current) return;
    ref.current = next;
    setHistory(next);
  }, []);

  useEffect(() => commit(readyCore().emptyPageHistory()), [commit, pageIndex]);
  useEffect(() => commit(readyCore().syncStrokeSteps(ref.current, depth)), [commit, depth]);

  const record = useCallback(
    (before: readonly FigureGeometry[], after: readonly FigureGeometry[], key: number | null) =>
      commit(readyCore().pushFigureStep(ref.current, before, after, key)),
    [commit],
  );

  const take = useCallback(
    (direction: "undo" | "redo"): PageStep | null => {
      const taken = readyCore().takePageStep(ref.current, direction);
      if (!taken) return null;
      commit(taken.history);
      return taken.step;
    },
    [commit],
  );

  return { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0, record, take };
}
