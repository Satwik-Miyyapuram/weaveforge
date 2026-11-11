/**
 * Backend config message (Rust `backend_config`), re-exported from index.ts.
 */
export {
  missingConfigMessage,
} from "../pkg/wf_wasm.js";

export type { BackendConfigField, BackendConfigFields } from "./bindings.js";
