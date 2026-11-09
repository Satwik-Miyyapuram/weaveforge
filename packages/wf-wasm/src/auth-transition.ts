/**
 * Auth session transition (Rust `auth_transition`), re-exported from index.ts.
 */
import { nextAuthStep as rawNextAuthStep } from "../pkg/wf_wasm.js";
import type { AuthStep } from "./bindings.js";

/** The decision for a session change. The caller builds user objects for the steps that need one. */
export type { AuthStep as RawAuthStep } from "./bindings.js";

/** What a session change means for the app (Rust `next_auth_step`). */
export function nextAuthStep(input: {
  userId: string | null;
  previousId: string | null;
  signingOut: boolean;
  wasExpired: boolean;
  desktop: boolean;
  localAccountId: string | null;
}): AuthStep {
  return rawNextAuthStep(
    input.userId ?? undefined,
    input.previousId ?? undefined,
    input.signingOut,
    input.wasExpired,
    input.desktop,
    input.localAccountId ?? undefined,
  ) as AuthStep;
}
