/**
 * MCP project pick (Rust `sync::project_pick`), re-exported from index.ts.
 * Keeps `pickProject` in apps/shell/sidecar/src/local-mcp-projects.ts; it returns the index so
 * the caller keeps its own object.
 */
import { pickProject as rawPickProject } from "../pkg/wf_wasm.js";
import type { PickableProject } from "./bindings.js";

export type { PickableProject } from "./bindings.js";

/** The index of the one project `needle` picks. Throws an `Error` naming the miss or the ambiguity. */
export function pickProject(projects: readonly PickableProject[], needle: string | null): number {
  try {
    return rawPickProject(projects, needle ?? undefined);
  } catch (error) {
    throw new Error(String(error));
  }
}
