"use client";

/**
 * The live sheet's ink (§ink-page-ink): the worker's own list once it has
 * answered for this page, the saved chunk until then — never the list of the
 * page just left, which is what the sheet would show for the frame a flip
 * takes. A held selection is left to the canvas, which draws it where the
 * drag has it.
 */

import { useEffect, useMemo, type RefObject } from "react";
import type { InkStroke } from "@weaveforge/core";

import type { InkWorkerMessage } from "../application/capture-protocol";
import type { InkSheetInk } from "./use-ink-worker-rpc";

export function useLiveSheetInk({
  sheetInk,
  pageIndex,
  saved,
  selection,
  sendRef,
}: {
  sheetInk: InkSheetInk | null;
  pageIndex: number;
  /** The page's strokes as its saved chunk has them. */
  saved: readonly InkStroke[] | undefined;
  selection: readonly number[];
  sendRef: RefObject<((message: InkWorkerMessage) => void) | null>;
}) {
  const liveInk = sheetInk?.pageIndex === pageIndex ? sheetInk : null;
  const strokes = liveInk ? liveInk.strokes : saved;
  const hidden = useMemo(() => {
    if (!liveInk || selection.length === 0) return undefined;
    const held = new Set(selection);
    const out = new Set<number>();
    liveInk.ids.forEach((id, at) => {
      if (held.has(id)) out.add(at);
    });
    return out;
  }, [liveInk, selection]);
  // Two frames on, the sheet has painted; letting go sooner blanks the stroke.
  useEffect(() => {
    if (!liveInk) return;
    const last = liveInk.ids[liveInk.ids.length - 1];
    const send = () =>
      sendRef.current?.({
        type: "ink-shown",
        pageIndex: liveInk.pageIndex,
        count: last === undefined ? 0 : last + 1,
      });
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(send);
    });
    return () => cancelAnimationFrame(frame);
  }, [liveInk, sendRef]);
  return { strokes, hidden };
}
