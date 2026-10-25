import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestVaultPageRepository } from "../postgrest-vault-page-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "@/backend/test/pg-test-db";

/** `list({ query })` over the real migrations (PGlite), as a signed-in user with RLS on. */
async function repoWith(pages: { title: string; body?: string }[]) {
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
  for (const page of pages) {
    const now = new Date().toISOString();
    await repo.save({ id: randomUUID(), title: page.title, body: page.body ?? "", sortOrder: 0, createdAt: now, updatedAt: now });
  }
  return repo;
}

const titles = async (repo: PostgrestVaultPageRepository, query: string) =>
  (await repo.list({ query })).map((p) => p.title).sort();

test("list({ query }) matches title or body, case-insensitively (34-18)", async () => {
  const repo = await repoWith([{ title: "Alpha" }, { title: "Beta", body: "mentions alpha" }, { title: "Gamma" }]);
  assert.deepEqual(await titles(repo, "ALPHA"), ["Alpha", "Beta"]);
});

test("list({ query }) treats a double quote as text, not the end of the value (34-18)", async () => {
  const repo = await repoWith([{ title: 'say "hi"' }, { title: "say hi" }]);
  assert.deepEqual(await titles(repo, '"hi"'), ['say "hi"']);
});

test("list({ query }) treats backslashes and LIKE wildcards as text (34-18)", async () => {
  const repo = await repoWith([{ title: "a\b" }, { title: "ab" }, { title: "100%" }, { title: "1000" }, { title: "x_y" }, { title: "xzy" }]);
  assert.deepEqual(await titles(repo, "a\b"), ["a\b"]);
  assert.deepEqual(await titles(repo, "0%"), ["100%"]);
  assert.deepEqual(await titles(repo, "x_y"), ["x_y"]);
});

test("list({ query }) with a comma or parenthesis does not split the filter (34-18)", async () => {
  const repo = await repoWith([{ title: "a, (b)" }, { title: "a" }]);
  assert.deepEqual(await titles(repo, ", (b)"), ["a, (b)"]);
});
