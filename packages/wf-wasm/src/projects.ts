/**
 * Project rules (Rust `projects`), re-exported from index.ts.
 */
import { projectName as rawProjectName } from "../pkg/wf_wasm.js";

/** The trimmed project name, or undefined when it is blank. */
export function projectName(name: string): string | undefined {
  return rawProjectName(name) ?? undefined;
}
