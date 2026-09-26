"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AuthUser } from "../domain/auth";
import { clearSessionCaches } from "@/lib/cache/clear-session-caches";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { clearAllScreenCaches } from "@/lib/cache/screen-cache";
import { setSessionLost } from "@/lib/session-lost";
import { localFirstActive, setLocalFirstAccount } from "@/backend/providers/local/local-first-marker";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /**
   * The session lapsed without anyone signing out. `user` is still the last
   * signed-in user so the app, and the workspace folder it mirrors, stay put;
   * the shell asks for a fresh sign-in instead of dropping to the login screen.
   */
  expired: boolean;
  /**
   * Bumped when a lapsed session comes back. Screens that loaded while signed
   * out hold the server's refusals; the shell keys on this so they load again.
   */
  sessionEpoch: number;
  signOut: () => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Provides auth state to the tree. Reads the current user once on mount and
 * subscribes to changes. All access to the auth service goes through the
 * container (composition root) — never supabase-js directly.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const wasExpired = useRef(false);
  const lastUser = useRef<AuthUser | null>(null);
  const signingOut = useRef(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void import("@/light-bootstrap").then(({ getLightContainer }) => {
      if (!active) return;
      const auth = getLightContainer().auth;
      // Resolve auth from the locally-stored session (no network): onChange
      // fires INITIAL_SESSION immediately with the persisted session, so cold
      // reopens paint instantly. Supabase auto-refreshes tokens in the
      // background and re-fires onChange; server-side RLS validates every data
      // request, so we don't block the UI on a getUser() round-trip (which also
      // used to sign users out when offline).
      unsubscribe = auth.onChange((u) => {
        if (!active) return;
        setLoading(false);
        const previous = lastUser.current;
        if (u === null) {
          // A desktop working on its own copy of the account opens with that
          // account even when the session is gone: the work is on this
          // computer, and only syncing it needs a sign-in.
          const account = previous || signingOut.current ? null : localFirstActive();
          if (account) {
            const offline: AuthUser = { id: account.id, email: account.email ?? undefined, providers: [] };
            lastUser.current = offline;
            wasExpired.current = true;
            setSessionLost(true);
            setExpired(true);
            setUser(offline);
            return;
          }
          // An expired or revoked session is not a sign-out. On the desktop
          // the person has a workspace folder open and work in progress;
          // wiping the session closed the folder and threw them onto the login
          // screen mid-sentence. Keep everything and ask them to sign back in.
          // Only a deliberate sign-out (or a browser, which has no folder to
          // lose) clears the session.
          if (previous && !signingOut.current && desktop()) {
            wasExpired.current = true;
            setSessionLost(true);
            setExpired(true);
            return;
          }
          wasExpired.current = false;
          setSessionLost(false);
          signingOut.current = false;
          lastUser.current = null;
          setExpired(false);
          clearSessionCaches();
          setUser(null);
          return;
        }
        // This window reads another account's copy on this computer. Start over
        // against the server; the new account's copy is set up from there.
        const onDisk = localFirstActive();
        if (onDisk && onDisk.id !== u.id) {
          setLocalFirstAccount(null);
          clearSessionCaches();
          window.location.reload();
          return;
        }
        // Signing back in as someone else must not inherit the last user's caches.
        if (previous && previous.id !== u.id) clearSessionCaches();
        else if (wasExpired.current) {
          // Back from a lapsed session as the same person. Nothing on this
          // device is wrong, only what was fetched while signed out: drop
          // those answers and let every screen ask again.
          invalidateAllRepoCaches();
          clearAllScreenCaches();
          setSessionEpoch((n) => n + 1);
        }
        wasExpired.current = false;
        setSessionLost(false);
        lastUser.current = u;
        setExpired(false);
        setUser(u);
      });
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  /**
   * Finishes a sign-in that came back to the desktop shell.
   *
   * The window never leaves the app's own origin during a provider sign-in —
   * the browser does that part — so nothing here reads a URL. The shell hands
   * over the callback's query string and this redeems it, which works because
   * the PKCE verifier was made in this renderer and has stayed in it.
   *
   * A browser has no bridge, so this subscribes to nothing and costs nothing.
   */
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let active = true;
    const stop = bridge.onSignIn((query) => {
      void import("@/light-bootstrap").then(async ({ getLightContainer }) => {
        if (!active) return;
        try {
          await getLightContainer().auth.completeOAuth(query);
        } catch (error) {
          // The auth listener above never fires for a failed exchange, so this
          // is the only place that knows. Left visible rather than swallowed:
          // the window otherwise sits on the sign-in screen with no reason.
          console.error("[weaveforge] sign-in could not be completed:", error);
        }
      });
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    wasExpired.current = false;
    // Signing out on purpose hands the window back to the server: the copy on
    // disk stays, and signing in again picks it up.
    const wasLocalFirst = localFirstActive() !== null;
    setLocalFirstAccount(null);
    setSessionLost(false);
    if (expired) {
      // The session is already gone, so the auth service has nothing to
      // announce; finish the sign-out here.
      lastUser.current = null;
      setExpired(false);
      setUser(null);
    }
    clearSessionCaches();
    const { getLightContainer } = await import("@/light-bootstrap");
    await getLightContainer().auth.signOut();
    // The repositories were wired to the local database; rewire them.
    if (wasLocalFirst) window.location.reload();
  }, [expired]);

  const updatePassword = useCallback(async (password: string) => {
    const { getLightContainer } = await import("@/light-bootstrap");
    await getLightContainer().auth.updatePassword(password);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, expired, sessionEpoch, signOut, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
