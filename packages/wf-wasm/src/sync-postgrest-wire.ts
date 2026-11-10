/**
 * PostgREST wire rules for the sync transport (Rust `sync::postgrest_wire`): which columns a
 * write may name, and what an error body says. The HTTP and retries stay in the web app.
 */
import type {
  ErrorInfo,
} from "./bindings.js";

export {
  postgrestErrorInfo,
  postgrestWritable,
} from "../pkg/wf_wasm.js";

export type { ErrorInfo } from "./bindings.js";

