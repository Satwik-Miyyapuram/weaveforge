/**
 * Window titles for routes (Rust `route_title`), re-exported from index.ts.
 */
import { labelForPath as rawLabelForPath, titleForPath as rawTitleForPath } from "../pkg/wf_wasm.js";
import type { NavRouteInput } from "./bindings.js";

export type { NavRouteInput } from "./bindings.js";

/** The window title for a route: "Papers · WeaveForge". */
export function titleForPath(pathname: string, navItems: readonly NavRouteInput[]): string {
  return rawTitleForPath(pathname, navItems);
}

/** The screen's own name ("Papers"), or null for a route with none. */
export function labelForPath(pathname: string, navItems: readonly NavRouteInput[]): string | null {
  return rawLabelForPath(pathname, navItems) ?? null;
}
