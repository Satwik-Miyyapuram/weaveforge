"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clampPage,
  clampScale,
  computeFitPageScale,
  computeFitWidthScale,
  initialReaderViewport,
  nextRotation,
  zoomIn as zoomInScale,
  zoomOut as zoomOutScale,
  type ReaderContainerSize,
  type ReaderFitMode,
  type ReaderPageSize,
  type ReaderRotation,
  type ReaderViewportState,
} from "@weaveforge/core";

export interface UseReaderViewportOptions {
  /** 1-based initial page. */
  initialPage?: number;
  /** Latest measured page size at scale 1 / rotation 0. */
  pageSize: ReaderPageSize | null;
  /** Latest measured scroll/viewport host size. */
  containerSize: ReaderContainerSize | null;
  numPages: number;
}

export interface ReaderViewportApi extends ReaderViewportState {
  /** Effective scale after applying fit mode. */
  renderScale: number;
  setPage: (page: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /**
   * Scale by `factor`, for a gesture rather than a button.
   *
   * A pinch reports a ratio per frame, and the ratio has to be applied to the
   * scale in force *now* — not to the one the closure was built with, or a fast
   * pinch compounds from a stale value and the page jumps. So this is the one
   * zoom that is a functional update, like `zoomIn`/`zoomOut` and unlike
   * `setCustomScale`.
   */
  zoomBy: (factor: number) => void;
  fitWidth: () => void;
  fitPage: () => void;
  rotateClockwise: () => void;
  setCustomScale: (scale: number) => void;
}

function effectiveBaseScale(
  state: ReaderViewportState,
  pageSize: ReaderPageSize | null,
  containerSize: ReaderContainerSize | null,
): number {
  if (state.fit !== "custom" && pageSize && containerSize) {
    return state.fit === "width"
      ? computeFitWidthScale(pageSize, containerSize, state.rotation)
      : computeFitPageScale(pageSize, containerSize, state.rotation);
  }
  return state.scale;
}

export function useReaderViewport(options: UseReaderViewportOptions): ReaderViewportApi {
  const { initialPage = 1, pageSize, containerSize, numPages } = options;
  const [state, setState] = useState<ReaderViewportState>(() =>
    initialReaderViewport(initialPage),
  );

  useEffect(() => {
    setState((prev) => ({ ...prev, page: clampPage(prev.page, Math.max(1, numPages)) }));
  }, [numPages]);

  const renderScale = effectiveBaseScale(state, pageSize, containerSize);

  const setPage = useCallback(
    (page: number) => {
      setState((prev) => ({ ...prev, page: clampPage(page, Math.max(1, numPages)) }));
    },
    [numPages],
  );

  const setFit = useCallback((fit: ReaderFitMode) => {
    setState((prev) => ({ ...prev, fit }));
  }, []);

  const zoomIn = useCallback(() => {
    setState((prev) => ({
      ...prev,
      fit: "custom",
      scale: zoomInScale(effectiveBaseScale(prev, pageSize, containerSize)),
    }));
  }, [pageSize, containerSize]);

  const zoomOut = useCallback(() => {
    setState((prev) => ({
      ...prev,
      fit: "custom",
      scale: zoomOutScale(effectiveBaseScale(prev, pageSize, containerSize)),
    }));
  }, [pageSize, containerSize]);

  const fitWidth = useCallback(() => setFit("width"), [setFit]);
  const fitPage = useCallback(() => setFit("page"), [setFit]);

  const zoomBy = useCallback(
    (factor: number) => {
      if (!Number.isFinite(factor) || factor <= 0) return;
      setState((prev) => ({
        ...prev,
        fit: "custom",
        scale: clampScale(effectiveBaseScale(prev, pageSize, containerSize) * factor),
      }));
    },
    [pageSize, containerSize],
  );

  const rotateClockwise = useCallback(() => {
    setState((prev) => ({ ...prev, rotation: nextRotation(prev.rotation) }));
  }, []);

  const setCustomScale = useCallback((scale: number) => {
    setState((prev) => ({ ...prev, fit: "custom", scale: clampScale(scale) }));
  }, []);

  return {
    ...state,
    scale: renderScale,
    renderScale,
    rotation: state.rotation as ReaderRotation,
    setPage,
    zoomIn,
    zoomOut,
    zoomBy,
    fitWidth,
    fitPage,
    rotateClockwise,
    setCustomScale,
  };
}
