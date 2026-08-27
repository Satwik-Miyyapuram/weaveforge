"use client";

/**
 * Working on this computer, with no account.
 *
 * The desktop shell already carries a database and a synthetic user for it —
 * `LOCAL_USER_ID`, which the row-level policies switch to on every local
 * query. What was missing was the half above: something that answers "who is
 * signed in" without a sign-in, so the app shell opens instead of stopping at
 * the login screen.
 *
 * This is not an offline copy of an account. There is no session, no token and
 * nothing to refresh, because there is no server on the other end: the data is
 * on this machine and the identity is the machine's. Everything an account
 * buys — sharing, sync, another device — is refused here in words rather than
 * failing later, and the reader turns it on by signing in, which switches the
 * app back to the Supabase wiring and leaves the local database untouched.
 */

import { LOCAL_USER_ID } from "@weaveforge/core";
import type { AuthChangeCallback, AuthUser, IAuthService } from "@weaveforge/core";
import type { ICurrentUserProvider } from "@weaveforge/core";

/** Where the choice is kept. The shell remembers it too, for the next launch. */
const CHOICE_KEY = "weaveforge.local-mode";

export const LOCAL_USER: AuthUser = {
  id: LOCAL_USER_ID,
  email: "you@this-computer",
  emailVerified: false,
  providers: ["local"],
};

/** Whether this window is working on the computer rather than on an account. */
export function isLocalMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHOICE_KEY) === "1";
  } catch {
    // A window with storage denied cannot remember a choice, so it has none.
    return false;
  }
}

/** Remember the choice. Reloading is the caller's job: the wiring is built once. */
export function setLocalMode(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(CHOICE_KEY, "1");
    else window.localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Nothing to do: the window simply starts on the sign-in screen next time.
  }
}

const NEEDS_ACCOUNT =
  "This copy is working on your computer, with no account. Sign in to use that.";

export class LocalAuthService implements IAuthService {
  async getUser(): Promise<AuthUser | null> {
    return LOCAL_USER;
  }

  /** No server, so no token. Callers already treat null as "do not send one". */
  async getAccessToken(): Promise<string | null> {
    return null;
  }

  async signInWithPassword(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async signUpWithPassword(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async updatePassword(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async sendPasswordReset(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async sendEmailOtp(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async verifyEmailOtp(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async sendMagicLink(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async signInWithGoogle(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
  async completeOAuth(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }

  /** Leaving local mode is the only "sign out" there is. The data stays. */
  async signOut(): Promise<void> {
    setLocalMode(false);
  }

  /**
   * Answers once, immediately, and never again.
   *
   * The provider above waits for the first callback before it stops showing a
   * loader, and there is nothing here that can change afterwards.
   */
  onChange(cb: AuthChangeCallback): () => void {
    const timer = setTimeout(() => cb(LOCAL_USER), 0);
    return () => clearTimeout(timer);
  }
}

export class LocalSessionProvider implements ICurrentUserProvider {
  async getCurrentUserId(): Promise<string | null> {
    return LOCAL_USER_ID;
  }
  async requireUserId(): Promise<string> {
    return LOCAL_USER_ID;
  }
}
