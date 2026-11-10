/**
 * Dark PDF rendering choice (Rust `reader::pdf_theme`), re-exported from index.ts.
 */
import { shouldUseDarkPdfRendering as rawShouldUseDarkPdfRendering } from "../pkg/wf_wasm.js";

/** Whether PDF pages render dark: `mode` is `"dark"`, or `themeId` names a dark theme. */
export function shouldUseDarkPdfRendering(
  themeId: string | null | undefined,
  mode?: string | null,
): boolean {
  return rawShouldUseDarkPdfRendering(themeId ?? undefined, mode ?? undefined) as boolean;
}
