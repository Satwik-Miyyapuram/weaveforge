import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { resetShowcaseProject } from "@/features/showcase/infrastructure/seed-showcase";
import { SHOWCASE_PROJECT_COLOR, SHOWCASE_PROJECT_NAME } from "@/features/showcase/domain/showcase-data/papers";
import { testDb } from "./pg-test-db";

/**
 * Resetting the showcase drops only the showcase project (review 36-18,
 * migration 0146). It used to delete every project of the user's with the
 * showcase's name, so a user's own project called "MSc Thesis (Showcase)" —
 * and everything under it, by cascade — went with it.
 */

const MIGRATION = new URL("../../../../../db/migrations/0146_project_showcase_flag.sql", import.meta.url);

async function fixture() {
  const db = await testDb();
  const user = await db.createUser();
  const client = createLocalClient(db.as(user).sql as LocalQuery) as unknown as SupabaseClient;
  const projects = () =>
    db.sql<{ id: string; is_showcase: boolean }>(
      "select id, is_showcase from projects where user_id = $1 order by created_at, id",
      [user],
    );
  return { db, user, client, projects };
}

test("a user project that shares the showcase name survives a reset", async () => {
  const { db, user, client, projects } = await fixture();
  const [mine] = await db.sql<{ id: string }>(
    "insert into projects (user_id, name, color) values ($1, $2, $3) returning id",
    [user, SHOWCASE_PROJECT_NAME, SHOWCASE_PROJECT_COLOR],
  );

  const showcaseId = await resetShowcaseProject(client, user, SHOWCASE_PROJECT_NAME);

  const rows = await projects();
  assert.deepEqual(rows.map((r) => r.id).sort(), [mine!.id, showcaseId].sort());
  assert.equal(rows.find((r) => r.id === mine!.id)!.is_showcase, false);
  assert.equal(rows.find((r) => r.id === showcaseId)!.is_showcase, true);
});

test("an earlier showcase project is replaced, not kept beside the new one", async () => {
  const { user, client, projects } = await fixture();
  const first = await resetShowcaseProject(client, user, SHOWCASE_PROJECT_NAME);
  const second = await resetShowcaseProject(client, user, SHOWCASE_PROJECT_NAME);

  assert.notEqual(first, second);
  assert.deepEqual((await projects()).map((r) => r.id), [second]);
});

test("a reset touches only the calling user's showcase", async () => {
  const { db, client, user } = await fixture();
  const other = await db.createUser();
  const otherClient = createLocalClient(db.as(other).sql as LocalQuery) as unknown as SupabaseClient;
  const theirs = await resetShowcaseProject(otherClient, other, SHOWCASE_PROJECT_NAME);

  await resetShowcaseProject(client, user, SHOWCASE_PROJECT_NAME);

  const [row] = await db.sql<{ n: number }>("select count(*)::int as n from projects where id = $1", [theirs]);
  assert.equal(row!.n, 1);
});

test("new projects are not showcase projects", async () => {
  const { db, user } = await fixture();
  const [row] = await db.sql<{ is_showcase: boolean }>(
    "insert into projects (user_id, name) values ($1, 'Thesis') returning is_showcase",
    [user],
  );
  assert.equal(row!.is_showcase, false);
});

test("the backfill flags only rows with the showcase name and colour", async () => {
  const { db, user, projects } = await fixture();
  // Rows as a database from before 0146 holds them: unflagged.
  const insert = (name: string, color: string | null) =>
    db.sql<{ id: string }>(
      "insert into projects (user_id, name, color, is_showcase) values ($1, $2, $3, false) returning id",
      [user, name, color],
    );
  const [seeded] = await insert(SHOWCASE_PROJECT_NAME, SHOWCASE_PROJECT_COLOR);
  const [otherColour] = await insert(SHOWCASE_PROJECT_NAME, "#ff0000");
  const [noColour] = await insert(SHOWCASE_PROJECT_NAME, null);
  const [otherName] = await insert("My thesis", SHOWCASE_PROJECT_COLOR);

  // The migration is safe to run again; re-running it is the backfill under test.
  await db.exec(readFileSync(MIGRATION, "utf8"));

  const flagged = new Set((await projects()).filter((r) => r.is_showcase).map((r) => r.id));
  assert.ok(flagged.has(seeded!.id));
  assert.ok(!flagged.has(otherColour!.id));
  assert.ok(!flagged.has(noColour!.id));
  assert.ok(!flagged.has(otherName!.id));
});

test("a project pulled without the flag (null) is not taken for the showcase", async () => {
  const { db, user, client, projects } = await fixture();
  const [pulled] = await db.sql<{ id: string }>(
    "insert into projects (user_id, name, color, is_showcase) values ($1, $2, $3, null) returning id",
    [user, SHOWCASE_PROJECT_NAME, SHOWCASE_PROJECT_COLOR],
  );

  await resetShowcaseProject(client, user, SHOWCASE_PROJECT_NAME);

  assert.ok((await projects()).some((r) => r.id === pulled!.id));
});
