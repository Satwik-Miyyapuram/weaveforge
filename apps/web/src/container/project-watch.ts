import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectLwwInvalidator } from "@/lib/cache/parts-1";

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
