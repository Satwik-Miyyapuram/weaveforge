/**
 * Stroke render mapping, from the Rust `render_strokes`. The types come from
 * bindings.ts; the function is the Rust export.
 */
import { toRenderStrokes as rawToRenderStrokes } from "../pkg/wf_wasm.js";
import type { InkRenderSource, InkRenderStroke } from "./bindings.js";

/**
 * The strokes as the renderer draws them, in source order, with positions in
 * `hidden` left out (Rust `to_render_strokes`). Each result carries its source
 * stroke's `points` array, the same one the caller holds, so a path cache keyed
 * on that array still hits.
 */
export function toRenderStrokes(
  strokes: readonly (InkRenderSource & { readonly points: readonly number[] })[] | undefined,
  palette: Readonly<Record<string, readonly [number, number, number]>>,
  hidden?: ReadonlySet<number>,
): (Omit<InkRenderStroke, "at" | "width"> & { width: number; readonly points: readonly number[] })[] {
  const list = strokes ?? [];
  const sources = list.map(({ colour, tool, width }) => ({ colour, tool, width }));
  const drawn: InkRenderStroke[] = rawToRenderStrokes(sources, palette, Uint32Array.from(hidden ?? []));
  // Rust f64 comes back null only for NaN; keep the old NaN.
  return drawn.map(({ at, width, ...rest }) => ({ ...rest, width: width ?? Number.NaN, points: list[at]?.points ?? [] }));
}
