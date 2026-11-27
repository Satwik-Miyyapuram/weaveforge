import { useLayoutEffect, useState, type RefObject } from "react";

/** Under this width the reader's side column folds to its rail (matches the `@container` stack in reader.css). */
export const NARROW_READER_PX = 600;

/** Whether `width` is narrow; a hidden (0-wide) element keeps `last`, so a background tab does not flip. */
export function isNarrow(width: number, last: boolean): boolean {
  return width === 0 ? last : width < NARROW_READER_PX;
}

/** True while `ref` is under NARROW_READER_PX wide. */
export function useNarrowWidth(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setNarrow((last) => isNarrow(el.clientWidth, last));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}
