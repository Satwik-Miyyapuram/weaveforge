import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectLwwInvalidator } from "@/lib/cache/parts-1";
import type { WiredBackend } from "./parts";

/**
 * The server db the project-change watch listens on, or null in files mode: personal data is in the
 * workspace folder, so the server db is not the source for project changes there.
 */
export function serverDbToWatch(backend: WiredBackend): WiredBackend["db"] | null {
  return "filesMode" in backend && backend.filesMode === true ? null : backend.db;
}

/**
 * Opens the project's realtime channel on the backend's database client, unless the
 * backend keeps personal data on the device (files mode). Files mode has no peers to
 * hear from, and the channel would otherwise reach the hosted realtime endpoint.
 */
export function watchProjectChannel(
  invalidator: Pick<ProjectLwwInvalidator, "watch">,
  backend: { db?: SupabaseClient; filesMode?: boolean },
  projectId: string | null,
): void {
  if (!backend.db || backend.filesMode === true) return;
  invalidator.watch(backend.db, projectId);
}
