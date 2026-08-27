import { readBackendConfig } from "@/backend/config";
import { createSupabaseClient } from "@/backend/providers/supabase/client";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { localBackendParts } from "@/backend/providers/local/wire-local-backend";

/**
 * @deprecated Prefer wireBackend() from @/backend/wire-backend.
 * Browser Supabase client singleton for legacy call sites.
 */
export function getSupabase() {
  // The legacy call sites reach for the client directly rather than through
  // the container, so this is where a copy working on this computer has to be
  // answered too — otherwise those few screens alone would go to the network.
  if (isLocalMode()) return localBackendParts().db;

  const config = readBackendConfig();
  const url = config.supabaseUrl;
  const key = config.supabaseAnonKey;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy apps/web/.env.local.example to .env.local and fill it in.",
    );
  }
  return createSupabaseClient(url, key, config.dataUrl);
}
