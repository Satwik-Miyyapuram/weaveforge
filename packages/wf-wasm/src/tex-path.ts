/**
 * TeX build-directory path check (Rust `tex_path`), re-exported from index.ts.
 */
import { safeRelative as rawSafeRelative } from "../pkg/wf_wasm.js";

/** The path normalised inside the build directory; throws with the refusal message otherwise. */
export function safeRelative(candidate: string): string {
  return rawSafeRelative(candidate) as string;
}
