/**
 * Screen cache id for a pathname (Rust `screen_for_path`), re-exported from index.ts.
 */
import { screenForPath as rawScreenForPath } from "../pkg/wf_wasm.js";

/** Screen cache id for a pathname, or null for detail/settings routes. */
export function screenForPath(pathname: string): string | null {
  return rawScreenForPath(pathname) ?? null;
}
