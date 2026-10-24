import type { AuthUser } from "./auth";

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

/** Decide what a session change means for the app. Pure; the provider applies it. */
export function nextAuthStep(input: AuthTransitionInput): AuthStep {
  const { user, previous, signingOut } = input;
  if (user === null) {
    // A desktop working on its own copy of the account opens with that
    // account even when the session is gone: the work is on this computer,
    // and only syncing it needs a sign-in.
    const account = previous || signingOut ? null : input.localAccount();
    if (account) {
      return { kind: "offline", user: { id: account.id, email: account.email ?? undefined, providers: [] } };
    }
    // An expired or revoked session is not a sign-out. On the desktop the
    // person has a workspace folder open and work in progress; keep everything
    // and ask them to sign back in. Only a deliberate sign-out (or a browser,
    // which has no folder to lose) clears the session.
    if (previous && !signingOut && input.desktop) return { kind: "expired" };
    return { kind: "signedOut" };
  }
  // This window reads another account's copy on this computer. Start over
  // against the server; the new account's copy is set up from there.
  const onDisk = input.localAccount();
  if (onDisk && onDisk.id !== user.id) return { kind: "otherAccountOnDisk" };
  // Signing back in as someone else must not inherit the last user's caches.
  const clearCaches = Boolean(previous && previous.id !== user.id);
  // Back from a lapsed session as the same person: only what was fetched while
  // signed out is wrong, so every screen asks again.
  const refetch = !clearCaches && input.wasExpired;
  return { kind: "signedIn", user, clearCaches, refetch };
}
