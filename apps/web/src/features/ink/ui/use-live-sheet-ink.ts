"use client";

/**
 * The live sheet's ink (§ink-page-ink): the worker's own list once it has
 * answered for this page, the saved chunk until then — never the list of the
 * page just left, which is what the sheet would show for the frame a flip
 * takes. A held selection is left to the canvas, which draws it where the
 * drag has it.
 */

import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { InkStroke } from "@weaveforge/core";

import type { InkWorkerMessage } from "../application/capture-protocol";
import type { InkSheetInk } from "./use-ink-worker-rpc";

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameStroke(a: InkStroke, b: InkStroke): boolean {
  return (
    a.t0 === b.t0 &&
    a.width === b.width &&
    a.tool === b.tool &&
    a.colour === b.colour &&
    a.shape === b.shape &&
    a.lineIndex === b.lineIndex &&
    sameNumbers(a.points, b.points) &&
    sameNumbers(a.pressures, b.pressures)
  );
}

/**
 * The worker's list with each unchanged stroke swapped for the object already
 * drawn. The worker's copies are new arrays, and outlines are cached per
 * `points` array, so without this every stroke's outline is rebuilt each time
 * the worker answers. The prior list itself comes back when nothing changed.
 */
export function reuseStrokes(
  next: readonly InkStroke[],
  prior: readonly InkStroke[] | undefined,
): readonly InkStroke[] {
  if (!prior || prior.length === 0) return next;
  const byStart = new Map<string, InkStroke[]>();
  for (const stroke of prior) {
    const key = `${stroke.t0}|${stroke.points.length}`;
    const list = byStart.get(key);
    if (list) list.push(stroke);
    else byStart.set(key, [stroke]);
  }
  let all = next.length === prior.length;
  const out = next.map((stroke, at) => {
    const list = byStart.get(`${stroke.t0}|${stroke.points.length}`);
    const found = list?.findIndex((old) => sameStroke(old, stroke)) ?? -1;
    if (found < 0 || !list) {
      all = false;
      return stroke;
    }
    const [old] = list.splice(found, 1);
    if (old !== prior[at]) all = false;
    return old;
  });
  return all ? prior : out;
}

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
  // What this page drew last, so the worker's next list reuses its strokes.
  const shown = useRef<{ pageIndex: number; strokes: readonly InkStroke[] | undefined } | null>(null);
  const strokes = useMemo(() => {
    if (!liveInk) return saved;
    const prior = shown.current?.pageIndex === pageIndex ? shown.current.strokes : saved;
    return reuseStrokes(liveInk.strokes, prior ?? saved);
  }, [liveInk, saved, pageIndex]);
  useEffect(() => {
    shown.current = { pageIndex, strokes };
  }, [pageIndex, strokes]);
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
