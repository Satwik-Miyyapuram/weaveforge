import { useCallback, type RefObject } from "react";

import { cachedRect } from "./rect-cache";

/**
 * Client coordinates to page units. The one projection everything shares.
 * Against the sheet, not the canvas: the canvas is only the visible part.
 */
export function useSheetProjection(
  sheetRef: RefObject<HTMLElement | null>,
  pageSize: { width: number; height: number },
): (clientX: number, clientY: number) => { x: number; y: number } | null {
  const { width, height } = pageSize;
  return useCallback(
    (clientX: number, clientY: number) => {
      const sheet = sheetRef.current;
      if (!sheet) return null;
      // Every coalesced sample projects; a cached rect keeps that off layout (perf I3).
      const box = cachedRect(sheet);
      return {
        x: ((clientX - box.left) / Math.max(box.width, 1)) * width,
        y: ((clientY - box.top) / Math.max(box.height, 1)) * height,
      };
    },
    [sheetRef, width, height],
  );
}
