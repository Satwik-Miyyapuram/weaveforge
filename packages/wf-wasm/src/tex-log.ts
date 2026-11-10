/**
 * TeX argument vectors and log parsing (Rust `tex_log`), re-exported from index.ts. The types mirror
 * the Rust structs; they are not in bindings.ts yet.
 */
import { texEngineArgs as rawTexEngineArgs, texLogErrors as rawTexLogErrors } from "../pkg/wf_wasm.js";
import type { TexEngineKind, TexErrorRow } from "./bindings.js";

export type { TexEngineKind, TexErrorRow } from "./bindings.js";

/** The argument vector for `engine` compiling `entry`. */
export function texEngineArgs(engine: TexEngineKind, entry: string): string[] {
  return rawTexEngineArgs(engine, entry) as string[];
}

/** The errors in a TeX log, one per place. */
export function texLogErrors(log: string, entry: string): TexErrorRow[] {
  return rawTexLogErrors(log, entry) as TexErrorRow[];
}
