import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Browser Supabase client (singleton). Used only by the Supabase backend provider. */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (client) return client;
  client = createClient(url, anonKey);
  return client;
}

export function resetSupabaseClientForTests(): void {
  client = null;
}
