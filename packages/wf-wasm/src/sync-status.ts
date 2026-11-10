/**
 * Sync remote status line (Rust `sync::git_remote::describe_status`): what the Settings
 * panel says about the connected remote and the commits to push or pull.
 */
import { describeRemoteStatus as rawDescribeRemoteStatus } from "../pkg/wf_wasm.js";
import type { RemoteStatusInput } from "./bindings.js";

export type { RemoteStatusInput } from "./bindings.js";

/** One line for the Settings panel. */
export function describeRemoteStatus(status: RemoteStatusInput): string {
  return rawDescribeRemoteStatus(status);
}
