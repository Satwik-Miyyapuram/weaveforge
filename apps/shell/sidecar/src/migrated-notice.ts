import fs from "node:fs";
import path from "node:path";

import { rust } from "@weaveforge/core";

/** File the new (Tauri) app writes into this data dir once it has copied it (phase-2-desktop.md, step 2.5). */
export const MIGRATED_MARKER = "migrated";

/** The warning for a data dir the new app has copied, or null when it never did. */
export function migratedNotice(userData: string): string | null {
  let raw: string | null;
  try {
    raw = fs.readFileSync(path.join(userData, MIGRATED_MARKER), "utf8");
  } catch (error) {
    // Any read error still means the marker is there; only a missing file means no notice.
    raw = (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "";
  }
  return rust().migratedNotice(raw);
}

/**
 * Shows the warning through `show` when the marker is there; returns whether it did. Never throws.
 * Only the instance holding the single-instance lock shows it; a second launch quits.
 */
export async function showMigratedNotice(
  userData: string,
  show: (options: { type: "warning"; message: string; detail: string }) => Promise<unknown>,
  isPrimary: () => boolean = () => true,
): Promise<boolean> {
  if (!isPrimary()) return false;
  const detail = migratedNotice(userData);
  if (detail === null) return false;
  try {
    await show({ type: "warning", message: "WeaveForge has moved to a new app", detail });
  } catch {
    // A dialog that cannot open must not stop the app from starting.
  }
  return true;
}
