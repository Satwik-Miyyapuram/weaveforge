import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestShareLinkRepository } from "../infrastructure/postgrest-share-link-repository";

const row = {
  id: "l1",
  owner_id: "u1",
  resource_type: "paper",
  resource_id: "p1",
  access: "view",
  expires_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

/** A client that records every select and answers with one row. */
function recordingClient() {
  const selects: string[] = [];
  const chain = {
    select(columns: string) {
      selects.push(columns);
      return chain;
    },
    eq: () => chain,
    order: () => Promise.resolve({ data: [row], error: null }),
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  const db = { from: () => chain } as unknown as SupabaseClient;
  return { db, selects };
}

const KEY_COLUMNS = /token_hash|dek_wrap|dek_epoch/;

test("reading a link back never selects its key material (33-18)", async () => {
  const { db, selects } = recordingClient();
  const repo = new PostgrestShareLinkRepository(db);
  const link = await repo.getById("l1");
  const links = await repo.listForResource("paper", "p1");
  assert.equal(selects.length, 2);
  for (const columns of selects) assert.doesNotMatch(columns, KEY_COLUMNS);
  assert.equal(link?.id, "l1");
  assert.equal(links[0]?.ownerId, "u1");
});
