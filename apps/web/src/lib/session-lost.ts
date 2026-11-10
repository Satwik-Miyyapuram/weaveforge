import { readyCore } from "@/lib/rust-core";

/**
 * Whether this window's account sign-in was lost while the app stayed open.
 *
 * Set by the auth provider on the desktop, where an ended session keeps the
 * workspace on screen rather than dropping to the sign-in page. Until the
 * person signs back in, every request to the account's server goes out without
 * a sign-in and the server refuses it — "permission denied for table projects"
 * on every card. That wording is true and useless: nothing is broken except the
 * sign-in, so while this is set the refusal is shown as what it means.
 *
 * Module state rather than context because `formatError` is called from
 * everywhere, including code with no React tree above it.
 */
let lost = false;

export function setSessionLost(value: boolean): void {
  lost = value;
}

export function isSessionLost(): boolean {
  return lost;
}

export const SESSION_LOST_MESSAGE = "You're signed out. Sign in to load this.";

/** A server refusal that, with no sign-in, means "sign in" rather than "not allowed". */
export function isSignedOutRefusal(message: string, code: string | null): boolean {
  // formatError calls this too, and it can run before the wasm core loads (or
  // in a test with no preload). When the core is not ready, report no refusal
  // rather than throw back into the formatter.
  try {
    return readyCore().isSignedOutRefusal(message, code);
  } catch {
    return false;
  }
}
