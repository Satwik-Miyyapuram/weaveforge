import { readBackendConfig } from "@/backend/config";
import { createSupabaseClient } from "@/backend/providers/supabase/client";

/**
 * @deprecated Prefer wireBackend() from @/backend/wire-backend.
 * Browser Supabase client singleton for legacy call sites.
 */
export function getSupabase() {
  const config = readBackendConfig();
  const url = config.supabaseUrl;
  const key = config.supabaseAnonKey;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy apps/web/.env.local.example to .env.local and fill it in.",
    );
  }
  return createSupabaseClient(url, key);
}

export type { SupabaseClient } from "@supabase/supabase-js";
