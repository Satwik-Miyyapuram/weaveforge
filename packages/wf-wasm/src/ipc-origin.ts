/**
 * IPC origin comparison (Rust `ipc_origin`), re-exported from index.ts. Electron event wiring stays in TypeScript.
 */
export {
  originOf,
  sameOrigin,
} from "../pkg/wf_wasm.js";
