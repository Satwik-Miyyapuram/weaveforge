/**
 * Local database engine start parameters (Rust `local_db_engine_params`), re-exported from index.ts.
 */
import {
  engineStartParams as rawEngineStartParams,
} from "../pkg/wf_wasm.js";

export {
  localDbSharedBuffers,
} from "../pkg/wf_wasm.js";

/** `defaults` with `-c shared_buffers=...` appended. `defaults` is not changed. */
export function engineStartParams(defaults: readonly string[]): string[] {
  return rawEngineStartParams(defaults) as string[];
}
