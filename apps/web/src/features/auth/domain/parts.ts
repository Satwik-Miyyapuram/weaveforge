import { readyCore } from "@/lib/rust-core";

import type { AuthUser } from "@weaveforge/core";

export type { AuthUser, IAuthService } from "@weaveforge/core";

// --- auth ---
/** Re-export from @weaveforge/core — auth port lives in the shared backend layer. */


// --- auth-transition ---
/** The account whose copy this desktop works on, if any. */
export interface LocalAccount {
  id: string;
  email: string | null;
}

export interface AuthTransitionInput {
  /** The user the auth service now reports; null when there is no session. */
  user: AuthUser | null;
  /** The last user the app showed. */
  previous: AuthUser | null;
  /** A deliberate sign-out is in progress. */
  signingOut: boolean;
  /** The last session lapsed without a sign-out. */
  wasExpired: boolean;
  /** Running in the desktop shell, which has a workspace folder to keep. */
  desktop: boolean;
  /** Read lazily: only some branches need it. */
  localAccount: () => LocalAccount | null;
}

export type AuthStep =
  | { kind: "offline"; user: AuthUser }
  | { kind: "expired" }
  | { kind: "signedOut" }
  | { kind: "otherAccountOnDisk" }
  | { kind: "signedIn"; user: AuthUser; clearCaches: boolean; refetch: boolean };

/**
 * Decide what a session change means for the app. Pure; the provider applies it.
 * The decision is Rust (`next_auth_step`); this adds the user objects and reads
 * the local copy only where a branch needs it.
 */
export function nextAuthStep(input: AuthTransitionInput): AuthStep {
  const { user, previous, signingOut } = input;
  // The local copy matters with no session (unless signing out or a last user
  // exists) and whenever a session exists (to spot another account's copy).
  const account = user !== null || (!previous && !signingOut) ? input.localAccount() : null;
  const step = readyCore().nextAuthStep({
    userId: user?.id ?? null,
    previousId: previous?.id ?? null,
    signingOut,
    wasExpired: input.wasExpired,
    desktop: input.desktop,
    localAccountId: account?.id ?? null,
  });
  if (step.kind === "offline" && account) {
    return { kind: "offline", user: { id: account.id, email: account.email ?? undefined, providers: [] } };
  }
  if (step.kind === "signedIn" && user) {
    return { kind: "signedIn", user, clearCaches: step.clearCaches, refetch: step.refetch };
  }
  if (step.kind === "offline" || step.kind === "signedIn") {
    throw new Error(`nextAuthStep: ${step.kind} without its account`);
  }
  return { kind: step.kind };
}
