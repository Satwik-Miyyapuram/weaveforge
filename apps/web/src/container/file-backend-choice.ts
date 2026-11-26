import { usesFileBackend, type Migrate097Resolved } from "@/lib/desktop/migrate-097";

/** The three personal-data backends the choice can pick from. */
export interface BackendChoices<T> {
  /** The file backend; absent until a lane injects one. */
  files?: () => T;
  /** PostgREST with writes on (web and Android, until their file wiring lands). */
  old: () => T;
  /** PostgREST with its repositories read-only (desktop fail-closed). */
  readOnly: () => T;
}

/**
 * The 0.9.7 kill switch for the personal-data backend.
 *
 * Files are used only when the folder's migration reports `verified` and a file
 * wiring was injected. On desktop, every other state (including `none`, an old
 * local database never exported) fails closed to read-only, so personal data
 * is never written to the server database there. Web and Android keep PostgREST
 * with writes on.
 */
export function chooseFileBackend<T>(
  migration: Migrate097Resolved | undefined,
  choices: BackendChoices<T>,
  onDesktop: boolean,
): T {
  if (choices.files && migration !== undefined && usesFileBackend(migration)) return choices.files();
  if (!onDesktop) return choices.old();
  return choices.readOnly();
}
