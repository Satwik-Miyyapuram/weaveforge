/**
 * Window titles for routes (Rust `route_title`), re-exported from index.ts.
 */
import {
  labelForPath as rawLabelForPath,
} from "../pkg/wf_wasm.js";
import type {
  NavRouteInput,
} from "./bindings.js";

export {
  titleForPath,
} from "../pkg/wf_wasm.js";

export type { NavRouteInput } from "./bindings.js";

/** The screen's own name ("Papers"), or null for a route with none. */
export function labelForPath(pathname: string, navItems: readonly NavRouteInput[]): string | null {
  return rawLabelForPath(pathname, navItems) ?? null;
}
