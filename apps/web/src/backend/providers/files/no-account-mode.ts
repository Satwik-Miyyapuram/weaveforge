"use client";

/**
 * The no-account choice: this window works on the computer, not on an account.
 * The only reader of the flag: everything else imports isLocalMode from here
 * (local-mode-gate-removed.test.ts). Same names and storage key as before the
 * move, so a stored choice still reads.
 */

import { readStored, removeStored, writeStored } from "@/lib/safe-storage";
import { readyCore } from "@/lib/rust-core";

/** Where the choice is kept. The shell remembers it too, for the next launch. */
const choiceKey = (): string => readyCore().localModeKey();

/** Whether this window is working on the computer rather than on an account. */
export function isLocalMode(): boolean {
  // A window with storage denied cannot remember a choice, so it has none.
  return readyCore().localIsLocalMode(readStored(choiceKey()) ?? undefined);
}

/**
 * Remember the choice. Reloading is the caller's job: the wiring is built once.
 * Throws when turning it on does not stick (storage denied or full), so the
 * caller shows why instead of reloading back onto the sign-in screen.
 */
export function setLocalMode(on: boolean): void {
  if (!on) {
    removeStored(choiceKey());
    return;
  }
  writeStored(choiceKey(), "1");
  if (!isLocalMode()) {
    throw new Error("Could not remember this choice: browser storage is unavailable in this window.");
  }
}
