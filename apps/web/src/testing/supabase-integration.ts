import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

export interface SupabaseTestSession {
  db: SupabaseClient;
}

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const val = process.env[name];
    if (val) return val;
  }
  return undefined;
}

/** Connect to a live Supabase project for contract tests; null when creds are missing. */
export async function connectSupabaseTest(): Promise<SupabaseTestSession | null> {
  const url = env("THESIS_TRACKER_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = env(
    "THESIS_TRACKER_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
  const email = env("THESIS_TRACKER_EMAIL", "SUPABASE_EMAIL", "TT_A_EMAIL");
  const password = env("THESIS_TRACKER_PASSWORD", "SUPABASE_PASSWORD", "TT_A_PASSWORD");
  if (!url || !key || !email || !password) return null;

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { db };
}
