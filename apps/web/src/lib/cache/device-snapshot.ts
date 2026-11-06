import { desktop } from "@/lib/desktop/desktop-bridge";
import { readStoredJson, writeStoredJson } from "@/lib/safe-storage";

/**
 * The last data a screen showed, kept on this device so a cold start can paint
 * it while the app's own database is still starting (seconds, after a crash).
 *
 * Desktop and phone only: a browser has no local database to wait for, and
 * account data left in its storage would outlive a shared computer's session.
 * Keys start with `weaveforge.`, so sign-out wipes them with the rest
 * (`clearLocalDeviceData`). A snapshot from another version reads as none.
 */
const PREFIX = "weaveforge.snapshot.";
const VERSION = 1;

interface Stored<T> {
  v?: number;
  value?: T;
}

export function readDeviceSnapshot<T>(name: string): T | null {
  if (!desktop()) return null;
  const stored = readStoredJson<Stored<T> | null>(PREFIX + name, null);
  if (!stored || typeof stored !== "object" || stored.v !== VERSION) return null;
  return stored.value ?? null;
}

export function writeDeviceSnapshot(name: string, value: unknown): void {
  if (!desktop()) return;
  writeStoredJson(PREFIX + name, { v: VERSION, value });
}
