"use client";

import { desktop } from "@/lib/desktop/desktop-bridge";
import { readStored, removeStored, writeStoredJson } from "@/lib/safe-storage";
import { readyCore } from "@/lib/rust-core";
import { isLocalMode } from "./local-identity";

/**
 * Which account this desktop's database belongs to, once it has been adopted
 * and has its first download. Kept apart from `local-first.ts` so the auth
 * provider can read it without pulling in the clients.
 */

const markerKey = (): string => readyCore().localFirstKey();

export interface LocalFirstAccount {
  id: string;
  email: string | null;
}

export function localFirstAccount(): LocalFirstAccount | null {
  return readyCore().localFirstMarkerAccount(readStored(markerKey()) ?? undefined);
}

export function setLocalFirstAccount(account: LocalFirstAccount | null): void {
  // Storage denied: the window starts in server mode next time, which works.
  if (account) writeStoredJson(markerKey(), account);
  else removeStored(markerKey());
}

/** Whether this window should be wired local-first. */
export function localFirstActive(): LocalFirstAccount | null {
  if (!readyCore().localFirstWanted(isLocalMode(), Boolean(desktop()))) return null;
  return localFirstAccount();
}
