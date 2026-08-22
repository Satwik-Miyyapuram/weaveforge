import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The two queries every by-id repository writes the same way.
 *
 * Nine repositories each spelled out "select the row whose id matches, throw
 * the PostgREST error, hand back null when there is none" and "delete the row
 * whose id matches". The table and the row type differ; the query does not.
 */
export async function rowById<R>(
  db: SupabaseClient,
  table: string,
  id: string,
  columns = "*",
): Promise<R | null> {
  const { data, error } = await db.from(table).select(columns).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as R | null) ?? null;
}

export async function deleteRowById(
  db: SupabaseClient,
  table: string,
  id: string,
): Promise<void> {
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw error;
}

/**
 * The shape every PostgREST builder resolves to: rows, or an error to throw.
 *
 * Awaiting a Supabase query builder gives back `{ data, error }`, and roughly
 * two hundred call sites destructured it, tested `error`, threw it, and cast
 * `data`. The two helpers below do that once so a query reads as the query.
 */
interface Resolved<T> {
  data: T | null;
  error: unknown;
}

export async function rows<R>(query: PromiseLike<Resolved<unknown>>): Promise<R[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data as R[] | null) ?? [];
}

export async function run(query: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await query;
  if (error) throw error;
}
