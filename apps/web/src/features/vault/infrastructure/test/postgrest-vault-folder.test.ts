import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestVaultPageRepository } from "../postgrest-vault-page-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "@/backend/test/pg-test-db";

/** A folder survives the real table (PGlite, migrations applied), as itself. */
test("a page saved as a folder reads back as one, in full and in the summary", async () => {
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
  const now = new Date().toISOString();
  const folder = { id: randomUUID(), title: "Methods", body: "", folder: true, sortOrder: 0, createdAt: now, updatedAt: now };
  const note = { id: randomUUID(), title: "Sampling", body: "", parentId: folder.id, sortOrder: 0, createdAt: now, updatedAt: now };
  await repo.save(folder);
  await repo.save(note);

  assert.equal((await repo.getById(folder.id))!.folder, true);
  assert.equal((await repo.getById(note.id))!.folder, false);
  const summaries = await repo.listSummaries();
  assert.equal(summaries.find((p) => p.id === folder.id)!.folder, true);
  assert.equal(summaries.find((p) => p.id === note.id)!.folder, false);
});
