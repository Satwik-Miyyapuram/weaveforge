"use client";

import { desktop } from "@/lib/desktop/desktop-bridge";
import { isLocalMode } from "./local-identity";

/**
 * Which account this desktop's database belongs to, once it has been adopted
 * and has its first download. Kept apart from `local-first.ts` so the auth
 * provider can read it without pulling in the clients.
 */

const MARKER_KEY = "weaveforge.local-first";

export interface LocalFirstAccount {
  id: string;
  email: string | null;
}

export function localFirstAccount(): LocalFirstAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalFirstAccount>;
    return typeof parsed.id === "string" ? { id: parsed.id, email: parsed.email ?? null } : null;
  } catch {
    return null;
  }
}

export function setLocalFirstAccount(account: LocalFirstAccount | null): void {
  try {
    if (account) window.localStorage.setItem(MARKER_KEY, JSON.stringify(account));
    else window.localStorage.removeItem(MARKER_KEY);
  } catch {
    // Storage denied: the window starts in server mode next time, which works.
  }
}

/** Whether this window should be wired local-first. */
export function localFirstActive(): LocalFirstAccount | null {
  if (isLocalMode() || !desktop()) return null;
  return localFirstAccount();
}
