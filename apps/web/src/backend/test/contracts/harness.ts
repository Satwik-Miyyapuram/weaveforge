/**
 * Shared setup for the repository contract tests.
 *
 * Each test gets its own user and project, so rows from one test never show up
 * in another's `list()` — the shared test database is one per process, not one
 * per test.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import type { ProjectContext } from "@/lib/parts-2";
import type { testDb } from "../pg-test-db";

export type Db = Awaited<ReturnType<typeof testDb>>;

/** The Rust repositories' client, acting as `userId` (RLS sees it as `auth.uid()`). */
export function clientFor(db: Db, userId: string): SupabaseClient {
  return createLocalClient(db.as(userId).sql as LocalQuery) as unknown as SupabaseClient;
}

/** Insert a project owned by `userId` and return its id. */
export async function seedProject(db: Db, userId: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    "insert into projects (user_id, name) values ($1, 'Contract') returning id",
    [userId],
  );
  return row!.id;
}

/**
 * The project the repositories scope every read and write to. `userId` is not
 * needed here: the rows take `user_id` from `auth.uid()` on insert.
 */
export function projectFor(projectId: string): ProjectContext {
  return { projectId };
}

/** A session that is always signed in as `userId`, for repositories that ask who is acting. */
export function sessionFor(userId: string): ICurrentUserProvider {
  return { getCurrentUserId: async () => userId, requireUserId: async () => userId };
}
