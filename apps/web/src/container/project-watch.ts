import type { WiredBackend } from "./parts";

/**
 * The server db the project-change watch listens on, or null in files mode: personal data is in the
 * workspace folder, so the server db is not the source for project changes there.
 */
export function serverDbToWatch(backend: WiredBackend): WiredBackend["db"] | null {
  return "filesMode" in backend && backend.filesMode === true ? null : backend.db;
}
