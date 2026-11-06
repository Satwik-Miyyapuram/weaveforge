import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { authHeaders } from "@/lib/auth-headers";
import { formatError } from "@/lib/format-error";
import {
  listWorkshopProjects,
  signInToWorkshop,
  signOutOfWorkshop,
  type WorkshopClientDeps,
  type WorkshopProject,
} from "@/features/overleaf/infrastructure/workshop-session-client";

/** Where this browser remembers its Workshop session id. Only the opaque id, never the cookie. */
export interface WorkshopSessionStore {
  get(): string | null;
  set(sessionId: string | null): void;
}

const STORAGE_KEY = "weaveforge.overleaf.workshopSession";

/** Per-browser convenience: storage can be missing or throw (private window), and then the user signs in again. */
export const browserStore: WorkshopSessionStore = {
  get() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  },
  set(sessionId) {
    try {
      if (sessionId) window.localStorage.setItem(STORAGE_KEY, sessionId);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* not remembered; nothing else depends on it */ }
  },
};

/** A copy with no account calls the shell's own routes, which take no bearer token. */
async function workshopHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  if (getContainer().auth.isLocalMode()) return { ...(extra as Record<string, string> | undefined) };
  return authHeaders(extra);
}

export const browserClient: WorkshopClientDeps = { fetch: (url, init) => fetch(url, init), authHeaders: workshopHeaders };

/**
 * Sign-in needs /api/overleaf/workshop routes. The hosted app has them, and the
 * Tauri shell serves them itself (apps/shell/src/overleaf_workshop.rs), so only a
 * browser copy with no account goes without.
 */
export function canShowWorkshop({ localMode, shell = false }: { localMode: boolean; shell?: boolean }): boolean {
  return !localMode || shell;
}

export interface WorkshopSession {
  sessionId: string | null;
  /** The account's projects; null while loading, signed out, or after a failed load. */
  projects: WorkshopProject[] | null;
  /** The project list failed for the stored session; `retry` loads it again. */
  loadFailed: boolean;
  busy: boolean;
  error: string;
  signInWithCookie(cookies: string): Promise<boolean>;
  signInWithWindow(): Promise<void>;
  disconnect(): Promise<void>;
  retry(): void;
  /** The session expired mid-use (e.g. opening a project): forget it and ask to sign in again. */
  expire(message: string): void;
}

/**
 * The Overleaf sign-in session: the id is kept in `store`, the cookie stays with
 * the routes (sealed on the server, or in this device's keychain in the shell).
 * `enabled` false (no routes) keeps it signed out and makes no request.
 */
export function useWorkshopSession({
  client,
  store,
  signInWindow,
  enabled = true,
}: {
  client: WorkshopClientDeps;
  store: WorkshopSessionStore;
  signInWindow?: () => Promise<string | null>;
  enabled?: boolean;
}): WorkshopSession {
  const [sessionId, setSessionId] = useState<string | null>(() => (enabled ? store.get() : null));
  const [projects, setProjects] = useState<WorkshopProject[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setProjects(null);
    setLoadFailed(false);
    void listWorkshopProjects(client, sessionId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setError("");
        setProjects(result.projects);
        return;
      }
      setError(result.message);
      if (result.expired) {
        store.set(null);
        setSessionId(null);
      } else {
        setLoadFailed(true);
      }
    });
    return () => { cancelled = true; };
  }, [sessionId, client, store, attempt]);

  function use(id: string) {
    store.set(id);
    setSessionId(id);
  }

  function forget() {
    store.set(null);
    setSessionId(null);
    setProjects(null);
    setLoadFailed(false);
  }

  return {
    sessionId,
    projects,
    loadFailed,
    busy,
    error,
    async signInWithCookie(cookies) {
      setBusy(true);
      setError("");
      const result = await signInToWorkshop(client, cookies);
      setBusy(false);
      if (!result.ok) { setError(result.message); return false; }
      use(result.sessionId);
      return true;
    },
    async signInWithWindow() {
      if (!signInWindow) return;
      setBusy(true);
      setError("");
      try {
        const id = await signInWindow();
        if (id) use(id);
      } catch (cause) {
        setError(formatError(cause));
      } finally {
        setBusy(false);
      }
    },
    async disconnect() {
      if (sessionId) await signOutOfWorkshop(client, sessionId);
      setError("");
      forget();
    },
    retry: () => setAttempt((n) => n + 1),
    expire(message) {
      setError(message);
      forget();
    },
  };
}
