import type { Migrate097Resolved } from "@/lib/desktop/migrate-097";

/** What the personal-data wiring was built from: the open folder and its migration state. */
export interface WiringKey {
  folder: string | null;
  migration: Migrate097Resolved | undefined;
}

/**
 * True when the wiring built at startup no longer matches the folder or the
 * migration, so the window must rewire (reload) before it trusts the choice.
 * Reaching `verified` is the only migration change that needs it: a move away
 * from `verified` is handled by the next start, which can only fail closed.
 */
export function wiringNeedsReload(built: WiringKey, now: WiringKey): boolean {
  if (built.folder !== now.folder) return true;
  return built.migration !== "verified" && now.migration === "verified";
}
