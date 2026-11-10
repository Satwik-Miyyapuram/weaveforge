/**
 * Sync remote status line (Rust `sync::git_remote::describe_status`): what the Settings
 * panel says about the connected remote and the commits to push or pull.
 */
import type {
  RemoteStatusInput,
} from "./bindings.js";

export {
  describeRemoteStatus,
} from "../pkg/wf_wasm.js";

export type { RemoteStatusInput } from "./bindings.js";

