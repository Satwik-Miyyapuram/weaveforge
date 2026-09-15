"use client";

/**
 * The worker's non-pen traffic, matched by request id.
 *
 * One worker, one door (§6.2): loading a page, the viewport transform, resize,
 * erase, undo, lasso, save and export all go through `pen.send`, because the
 * pen path owns the worker and a second one would double the geometry. This
 * is that door's *answers*: the worker replies to an ask with a `requestId`,
 * and this holds the promise resolver that id belongs to, plus the state a
 * reply sets — the undo/redo counts, the page's size, the lasso's selection.
 */

import { useCallback, useRef, useState } from "react";
import type { InkPage } from "@weaveforge/core";

import type { InkWorkerEvent, InkWorkerMessage } from "../application/capture-protocol";
import { PNG_EXPORT_SCALE } from "./use-page-export";

/** What the door needs from the host. */
export interface InkWorkerRpcDeps {
  /**
   * The one door, by ref: the pen hook owns the worker and this hook's
   * answer handler is one of the pen's inputs, so the door is handed over as
   * a ref the host fills the moment the pen exists — the requests below all
   * run long after that.
   */
  sendRef: {
    current:
      | ((message: InkWorkerMessage, transfer?: Transferable[]) => void)
      | null;
  };
  /** The page size to start from: the note's paper, before the worker speaks. */
  initialPageSize: { width: number; height: number };
}

/**
 * The replies, as state and as promises.
 *
 * `requestModel`/`requestSave`/`requestExport` return a promise per ask; the
 * worker answers by id, so a late answer for an ask that is already off is
 * still delivered to whoever asked, not dropped on the floor.
 */
export function useInkWorkerRpc(deps: InkWorkerRpcDeps) {
  const sendRef = deps.sendRef;
  const send = useCallback(
    (message: InkWorkerMessage, transfer?: Transferable[]) =>
      sendRef.current?.(message, transfer),
    [sendRef],
  );

  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [strokes, setStrokes] = useState(0);
  const [selection, setSelection] = useState<number[]>([]);
  const [selectionBounds, setSelectionBounds] = useState<
    readonly [number, number, number, number] | null
  >(null);
  const [pageSize, setPageSize] = useState(deps.initialPageSize);
  const requestSeq = useRef(0);
  const pendingModel = useRef(new Map<number, (page: InkPage) => void>());
  const pendingSave = useRef(new Map<number, (bytes: Uint8Array | null) => void>());
  const pendingExport = useRef(new Map<number, (png: Blob | null) => void>());

  /** The worker's non-pen replies, matched to what asked for them. */
  const onEvent = useCallback((event: InkWorkerEvent) => {
    switch (event.type) {
      case "history":
        setHistory({ undo: event.undo, redo: event.redo });
        break;
      case "page-state":
        setStrokes(event.strokes);
        setPageSize((size) =>
          size.width === event.width && size.height === event.height
            ? size
            : { width: event.width, height: event.height },
        );
        break;
      case "page-model":
        pendingModel.current.get(event.requestId)?.(event.page);
        pendingModel.current.delete(event.requestId);
        break;
      case "page-saved":
        pendingSave.current.get(event.requestId)?.(event.bytes);
        pendingSave.current.delete(event.requestId);
        break;
      case "exported":
        pendingExport.current.get(event.requestId)?.(event.png);
        pendingExport.current.delete(event.requestId);
        break;
      case "selected":
        setSelection(event.indices);
        setSelectionBounds(event.bounds);
        break;
      case "error":
        // The worker keeps the strokes when it cannot draw them; the readout
        // says "none" for the backend, and this says why, where a developer
        // tools console will show it. Nothing else in the app hears it.
        console.error(`ink: the renderer failed — ${event.message}`);
        break;
      default:
        break;
    }
  }, []);

  /** A request the worker answers by id: the page's model. */
  const requestModel = useCallback(() => {
    return new Promise<InkPage>((resolve) => {
      const requestId = ++requestSeq.current;
      pendingModel.current.set(requestId, resolve);
      send({ type: "page-model", requestId });
    });
  }, [send]);

  /** A request the worker answers by id: the page's chunk bytes. */
  const requestSave = useCallback(() => {
    return new Promise<Uint8Array | null>((resolve) => {
      const requestId = ++requestSeq.current;
      pendingSave.current.set(requestId, resolve);
      send({ type: "save-page", requestId });
    });
  }, [send]);

  /**
   * A request the worker answers by id: the page's raster. The `transparent`
   * flag asks for the ink without its sheet of white, for the compose the
   * export pipeline does around figures.
   */
  const requestExport = useCallback(
    (scale: number = PNG_EXPORT_SCALE, transparent = false) => {
      return new Promise<Blob | null>((resolve) => {
        const requestId = ++requestSeq.current;
        pendingExport.current.set(requestId, resolve);
        send({ type: "export-page", requestId, scale, transparent });
      });
    },
    [send],
  );

  return {
    history,
    strokes,
    setStrokes,
    selection,
    setSelection,
    selectionBounds,
    setSelectionBounds,
    pageSize,
    setPageSize,
    onEvent,
    requestModel,
    requestSave,
    requestExport,
  };
}
