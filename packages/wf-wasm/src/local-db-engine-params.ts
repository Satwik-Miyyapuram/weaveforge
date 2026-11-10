/**
 * Local database engine start parameters (Rust `local_db_engine_params`), re-exported from index.ts.
 */
import {
  engineStartParams as rawEngineStartParams,
  localDbSharedBuffers as rawLocalDbSharedBuffers,
} from "../pkg/wf_wasm.js";

/** The `shared_buffers` value the local engine runs with. */
export function localDbSharedBuffers(): string {
  return rawLocalDbSharedBuffers();
}

/** `defaults` with `-c shared_buffers=...` appended. `defaults` is not changed. */
export function engineStartParams(defaults: readonly string[]): string[] {
  return rawEngineStartParams(defaults) as string[];
}
