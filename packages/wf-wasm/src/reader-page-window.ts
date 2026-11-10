/**
 * Rendered-page eviction (Rust `reader_page_window`). Keeps the signature of
 * apps/web/src/features/reader/ui/pdf-reader/pdf-page-window.ts. The idle
 * scheduling helper stays in TypeScript.
 */
import { pagesToEvict as rawPagesToEvict } from "../pkg/wf_wasm.js";

/** Pages farther than this from every visible page are evicted by default. */
export const PDF_KEEP_RADIUS = 3;

/** The rendered pages more than `radius` pages from every visible page, sorted ascending. */
export function pagesToEvict(
  rendered: readonly number[],
  visible: readonly number[],
  radius: number = PDF_KEEP_RADIUS,
): number[] {
  return rawPagesToEvict(rendered, visible, radius) as number[];
}
