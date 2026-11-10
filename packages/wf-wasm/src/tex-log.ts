/**
 * TeX argument vectors and log parsing (Rust `tex_log`), re-exported from index.ts. The types mirror
 * the Rust structs; they are not in bindings.ts yet.
 */
import type {
  TexEngineKind,
  TexErrorRow,
} from "./bindings.js";

export {
  texEngineArgs,
  texLogErrors,
} from "../pkg/wf_wasm.js";

export type { TexEngineKind, TexErrorRow } from "./bindings.js";

