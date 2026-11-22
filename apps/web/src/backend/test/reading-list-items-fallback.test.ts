import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { wirePostgrestBackend, type BackendParts } from "@/backend/providers/postgrest/wire-postgrest-backend";
import type { ProjectContext } from "@/lib/parts-2";

/**
 * The files-only reads (`unreadablePaths`, `legacyLeftovers`) have no PostgREST
 * source. On the fallback backend they answer empty, so the lists screen loads.
 */
test("the PostgREST reading-list repo answers the files-only reads with nothing", async () => {
  const db = { from: () => ({}) } as unknown as SupabaseClient;
  const parts = {
    db,
    session: { getCurrentUserId: async () => "u", requireUserId: async () => "u" },
    auth: { getAccessToken: async () => "token" },
    blobStore: {},
    settingsRepository: {},
  } as unknown as BackendParts;
  const projectContext = { get: () => "proj-1" } as unknown as ProjectContext;
  const backend = wirePostgrestBackend({} as never, projectContext, () => "proj-1", parts);

  const repo = backend.readingListItemRepository;
  assert.deepEqual(await repo.unreadablePaths?.(), []);
  assert.deepEqual(await repo.legacyLeftovers?.(), []);
  assert.deepEqual(await repo.legacyLeftovers?.("list-1"), []);
});
