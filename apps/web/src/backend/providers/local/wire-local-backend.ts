import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyWorkspaceChange } from "@/lib/workspace-changes";
import { PostgrestSettingsRepository } from "@/features/settings/infrastructure/postgrest-settings-repository";
import { watchWrites } from "../postgrest/watch-writes";
import type { BackendParts } from "../postgrest/wire-postgrest-backend";
import { createLocalClient, type LocalQuery } from "./pglite-client";
import { LocalAuthService, LocalSessionProvider } from "./local-identity";
import { LocalBlobStore } from "./local-blob-store";
import { localRunnerQuery } from "./local-runner";
import { DeviceSecretsStore } from "./device-secrets-store";

/**
 * The three things that make the app run on this computer alone.
 *
 * The repositories are untouched: they get a client with the same shape, an
 * identity that answers without a session, and a blob store that keeps bytes
 * in the local database. Writes are wrapped the same way as the PostgREST
 * client's, so the folder mirror, the local HTTP surface and the MCP server
 * hear about a local edit exactly as they hear about a synced one.
 *
 * The settings repository is the account one with the credentials store swapped,
 * not a subclass: the difference was never the mode, only where secrets can
 * live. See `DeviceSecretsStore`.
 */
export function localBackendParts(query: LocalQuery = localRunnerQuery()): BackendParts {
  const db = watchWrites(createLocalClient(query) as unknown as SupabaseClient, notifyWorkspaceChange);
  const session = new LocalSessionProvider();
  return {
    db,
    session,
    settingsRepository: new PostgrestSettingsRepository(db, session, new DeviceSecretsStore(query)),
    auth: new LocalAuthService(),
    blobStore: new LocalBlobStore(query),
  };
}
