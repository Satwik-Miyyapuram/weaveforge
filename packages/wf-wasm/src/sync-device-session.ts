/**
 * Which signed-in session drives this device's sync (Rust `sync::device_session`).
 * The device adopts one account; only that account's session runs the loop.
 */
import {
  mayDriveDevice as rawMayDriveDevice,
  sessionAction as rawSessionAction,
} from "../pkg/wf_wasm.js";

/** What a window does for the session it holds. */
export type SessionAction = "idle" | "adopt" | "drive" | "foreign";

/** True when the signed-in user is the account this device adopted. */
export function mayDriveDevice(signedInUserId: string | null, adoptedAccountId: string | null): boolean {
  return rawMayDriveDevice(signedInUserId ?? undefined, adoptedAccountId ?? undefined);
}

/** What the session does for this device. */
export function sessionAction(signedInUserId: string | null, adoptedAccountId: string | null): SessionAction {
  return rawSessionAction(signedInUserId ?? undefined, adoptedAccountId ?? undefined) as SessionAction;
}
