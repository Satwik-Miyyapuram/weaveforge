/**
 * Signed-out refusal check (Rust `signed_out`), re-exported from index.ts.
 */
import { isSignedOutRefusal as rawIsSignedOutRefusal } from "../pkg/wf_wasm.js";

/** True when a server refusal, with no sign-in, means "sign in" rather than "not allowed" (Rust `is_signed_out_refusal`). */
export function isSignedOutRefusal(message: string, code: string | null): boolean {
  return rawIsSignedOutRefusal(message, code ?? undefined);
}
