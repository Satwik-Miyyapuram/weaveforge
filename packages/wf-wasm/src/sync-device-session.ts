/**
 * Which signed-in session drives this device's sync (Rust `sync::device_session`).
 * The device adopts one account; only that account's session runs the loop.
 */
export {
  mayDriveDevice,
  sessionAction,
} from "../pkg/wf_wasm.js";

/** What a window does for the session it holds. */
export type SessionAction = "idle" | "adopt" | "drive" | "foreign";
