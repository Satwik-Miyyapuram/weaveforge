/**
 * Screen-cache ages (Rust `cache_policy`), re-exported from index.ts. The app keeps its own
 * constants for module-evaluation-time reads; this is for callers that run after wasm init.
 */
import { screenCachePolicy as rawScreenCachePolicy } from "../pkg/wf_wasm.js";
import type { ScreenCachePolicy } from "./bindings.js";

/** `{ revalidateAfterMs, showMaxAgeMs }`: both screen-cache ages, in milliseconds. */
export function screenCachePolicy(): ScreenCachePolicy {
  return rawScreenCachePolicy() as ScreenCachePolicy;
}
