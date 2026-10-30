import fs from "node:fs";
import path from "node:path";

/** File the new (Tauri) app writes into this data dir once it has copied it (phase-2-desktop.md, step 2.5). */
export const MIGRATED_MARKER = "migrated";

/** The warning for a data dir the new app has copied, or null when it never did. */
export function migratedNotice(userData: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(userData, MIGRATED_MARKER), "utf8");
  } catch (error) {
    // Any read error still means the marker is there; only a missing file means no notice.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    raw = "";
  }
  return `Your WeaveForge data was copied to the new WeaveForge app${whenOf(raw)}. Changes you make in this version stay here and do not reach the new app, so use the new app instead.`;
}

/** Shows the warning through `show` when the marker is there; returns whether it did. Never throws. */
export async function showMigratedNotice(
  userData: string,
  show: (options: { type: "warning"; message: string; detail: string }) => Promise<unknown>,
): Promise<boolean> {
  const detail = migratedNotice(userData);
  if (detail === null) return false;
  try {
    await show({ type: "warning", message: "WeaveForge has moved to a new app", detail });
  } catch {
    // A dialog that cannot open must not stop the app from starting.
  }
  return true;
}

/** " on <date>" from the marker's `at`, or "" when the marker is not the JSON the new app writes. */
function whenOf(raw: string): string {
  try {
    const at = (JSON.parse(raw) as { at?: unknown }).at;
    if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return "";
    return ` on ${at.slice(0, 10)}`;
  } catch {
    return "";
  }
}
