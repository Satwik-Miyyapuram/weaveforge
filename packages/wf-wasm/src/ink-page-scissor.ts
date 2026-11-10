/**
 * WebGL page scissor box (Rust `ink::page_scissor`), re-exported from index.ts.
 */
import { inkPageScissor as rawInkPageScissor } from "../pkg/wf_wasm.js";

/**
 * The page's `[x, y, width, height]` scissor box on a device-pixel surface. `view` is the
 * view's `scale` and `offsetX`/`offsetY` in CSS px; `page` and `surface` are sizes.
 */
export function inkPageScissor(
  view: { scale: number; offsetX: number; offsetY: number },
  dpr: number,
  page: { width: number; height: number },
  surface: { width: number; height: number },
): [number, number, number, number] {
  const box = rawInkPageScissor(
    view.scale,
    view.offsetX,
    view.offsetY,
    dpr,
    page.width,
    page.height,
    surface.width,
    surface.height,
  );
  return [box[0]!, box[1]!, box[2]!, box[3]!];
}
