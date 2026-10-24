import type { SupabaseClient } from "@supabase/supabase-js";
import { runPaperRepositoryContract } from "@weaveforge/core/testing";

import { PostgrestPaperRepository } from "../postgrest-paper-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * The shared paper contract, run against the adapter the app uses.
 *
 * The suite only ever ran against the in-memory repository, so it proved the
 * fake agreed with itself. Here it runs against `PostgrestPaperRepository` over
 * the real migrations (PGlite), through the local client the desktop app sends
 * its queries with, as a signed-in user with RLS on.
 *
 * Each test gets a new user and project, so each starts from an empty library.
 */
runPaperRepositoryContract("PostgREST over PGlite", async () => {
  const db = await testDb();
  const user = await db.createUser();
  const sql = db.as(user).sql;
  const [project] = await sql<{ id: string }>(
    "insert into projects (user_id, name) values ($1, 'Contract') returning id",
    [user],
  );
  return new PostgrestPaperRepository(
    createLocalClient(asDesktopRows(sql as LocalQuery)) as unknown as SupabaseClient,
    { projectId: project!.id },
  );
});

/**
 * Rows shaped the way the desktop engine hands them over: a timestamp as ISO
 * text, as PostgREST sends it (`main-local-db.ts` sets that parser). The test
 * database keeps PGlite's default, a `Date`, which no running app ever sees.
 */
function asDesktopRows(query: LocalQuery): LocalQuery {
  return async (text, params) => {
    const result = (await query(text, params)) as Record<string, unknown>[];
    return result.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
      ),
    );
  };
}
