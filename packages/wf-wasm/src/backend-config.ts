/**
 * Backend config message (Rust `backend_config`), re-exported from index.ts.
 */
import { missingConfigMessage as rawMissingConfigMessage } from "../pkg/wf_wasm.js";
import type { BackendConfigField, BackendConfigFields } from "./bindings.js";

export type { BackendConfigField, BackendConfigFields } from "./bindings.js";

/**
 * Names the required fields that are absent (env var names only, never values),
 * or null when every required field is set.
 */
export function missingConfigMessage(
  cfg: BackendConfigFields,
  required: readonly BackendConfigField[],
): string | null {
  return rawMissingConfigMessage(cfg, [...required]) as string | null;
}
