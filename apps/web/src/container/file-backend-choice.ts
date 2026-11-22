import { usesFileBackend, type Migrate097Resolved } from "@/lib/desktop/migrate-097";

/**
 * The 0.9.7 kill switch for the personal-data backend. Files are used only
 * when the folder's migration reports `verified` and a file wiring was
 * injected. Any other state, or no injection, keeps the PostgREST wiring with
 * writes on, so an interrupted export never changes what the user can do.
 */
export function chooseFileBackend<T>(
  migration: Migrate097Resolved | undefined,
  wireFiles: (() => T) | undefined,
  wireOld: () => T,
): T {
  if (wireFiles && migration !== undefined && usesFileBackend(migration)) return wireFiles();
  return wireOld();
}
