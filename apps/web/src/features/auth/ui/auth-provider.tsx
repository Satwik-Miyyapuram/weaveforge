"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AuthUser } from "../domain/auth";
import { clearSessionCaches } from "@/lib/cache/clear-session-caches";
import { desktop } from "@/lib/desktop/desktop-bridge";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
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
        if (u === null) clearSessionCaches();
        setUser(u);
        setLoading(false);
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
    clearSessionCaches();
    const { getLightContainer } = await import("@/light-bootstrap");
    await getLightContainer().auth.signOut();
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { getLightContainer } = await import("@/light-bootstrap");
    await getLightContainer().auth.updatePassword(password);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
