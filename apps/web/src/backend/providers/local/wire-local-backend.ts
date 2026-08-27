import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyWorkspaceChange } from "@/lib/workspace-changes";
import { watchWrites } from "../supabase/watch-writes";
import type { BackendParts } from "../supabase/wire-supabase-backend";
import { createLocalClient, type LocalQuery } from "./pglite-client";
import { LocalAuthService, LocalSessionProvider } from "./local-identity";
import { LocalBlobStore } from "./local-blob-store";
import { LocalRunner } from "./local-runner";
import { LocalSettingsRepository } from "./local-settings-repository";

/**
 * The three things that make the app run on this computer alone.
 *
 * The repositories are untouched: they get a client with the same shape, an
 * identity that answers without a session, and a blob store that keeps bytes
 * in the local database. Writes are wrapped the same way as the Supabase
 * client's, so the folder mirror, the local HTTP surface and the MCP server
 * hear about a local edit exactly as they hear about a synced one.
 */
export function localBackendParts(query: LocalQuery = defaultQuery()): BackendParts {
  const db = watchWrites(createLocalClient(query) as unknown as SupabaseClient, notifyWorkspaceChange);
  const session = new LocalSessionProvider();
  return {
    db,
    session,
    settingsRepository: new LocalSettingsRepository(db, session, query),
    auth: new LocalAuthService(),
    blobStore: new LocalBlobStore(query),
  };
}

/** Straight to the shell. The identity is applied on the far side, not here. */
function defaultQuery(): LocalQuery {
  const runner = new LocalRunner();
  return (sql, params) => runner.query(sql, params as never[]);
}
