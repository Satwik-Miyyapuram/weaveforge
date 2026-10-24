import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestVaultPageRepository } from "../postgrest-vault-page-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "@/backend/test/pg-test-db";

/** `titleTaken` over the real migrations (PGlite), as a signed-in user with RLS on. */
async function repoWith(titles: string[]) {
  const db = await testDb();
  const user = await db.createUser();
  const sql = db.as(user).sql;
  const [project] = await sql<{ id: string }>(
    "insert into projects (user_id, name) values ($1, 'Vault') returning id",
    [user],
  );
  const repo = new PostgrestVaultPageRepository(
    createLocalClient(sql as LocalQuery) as unknown as SupabaseClient,
    { projectId: project!.id },
  );
  const ids: string[] = [];
  for (const title of titles) {
    const id = randomUUID();
    ids.push(id);
    const now = new Date().toISOString();
    await repo.save({ id, title, body: "", sortOrder: 0, createdAt: now, updatedAt: now });
  }
  return { repo, ids };
}

test("titleTaken matches case and whitespace like the domain rule (05-02)", async () => {
  const { repo } = await repoWith(["Deep  Learning"]);
  assert.equal(await repo.titleTaken("  deep learning "), true);
  assert.equal(await repo.titleTaken("deep\tLEARNING"), true);
  assert.equal(await repo.titleTaken("deep learnings"), false);
  assert.equal(await repo.titleTaken("deepxlearning"), false);
});

test("titleTaken treats LIKE wildcards and quotes as literal text (05-02)", async () => {
  const { repo } = await repoWith(["100% 'done'_x", "a\\b"]);
  assert.equal(await repo.titleTaken("100% 'DONE'_x"), true);
  assert.equal(await repo.titleTaken("100x 'done'ax"), false);
  assert.equal(await repo.titleTaken("1%"), false);
  assert.equal(await repo.titleTaken("a\\b"), true);
  assert.equal(await repo.titleTaken("a\\\\b"), false);
});

test("titleTaken ignores the page being renamed and empty titles (05-02)", async () => {
  const { repo, ids } = await repoWith(["Notes"]);
  assert.equal(await repo.titleTaken("notes", ids[0]), false);
  assert.equal(await repo.titleTaken("notes", randomUUID()), true);
  assert.equal(await repo.titleTaken("   "), false);
});
