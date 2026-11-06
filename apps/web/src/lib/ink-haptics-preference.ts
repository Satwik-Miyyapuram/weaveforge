import { readStored, writeStored } from "@/lib/safe-storage";

/**
 * Whether the pen's haptics play while drawing, where the OS has them.
 *
 * On by default. A per-device preference, stored like the editor's others:
 * the pen is this machine's, not the workspace's.
 */
const STORAGE_KEY = "thesis.inkHaptics";

export function parseInkHapticsOn(raw: unknown): boolean {
  return raw !== "off";
}

export function readInkHapticsOn(): boolean {
  return parseInkHapticsOn(readStored(STORAGE_KEY));
}

export function writeInkHapticsOn(on: boolean): void {
  writeStored(STORAGE_KEY, on ? "on" : "off");
}
