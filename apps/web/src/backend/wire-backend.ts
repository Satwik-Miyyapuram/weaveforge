import type { BackendConfig } from "./config";
import { readBackendConfig } from "./config";
import type { IAdminUserProvisioner } from "@weaveforge/core";
import { SupabaseAdminUserProvisioner } from "./providers/supabase/admin-provisioner";
import { wireSupabaseBackend, type WiredSupabaseBackend } from "./providers/supabase/wire-supabase-backend";

export type WiredBackend = WiredSupabaseBackend;

export function wireBackend(
  config: BackendConfig = readBackendConfig(),
  projectContext = { projectId: null as string | null },
  pid: () => string | null = () => projectContext.projectId,
): WiredBackend {
  switch (config.provider) {
    case "supabase":
      return wireSupabaseBackend(config, projectContext, pid);
    // `postgres` selects the server-side blob registry (storage/server/blob-api.ts),
    // never a browser data layer: these repositories reach the database over
    // PostgREST, which a connection string cannot replace. Point them at your own
    // database with NEXT_PUBLIC_DATA_URL instead — see docs/backend.md.
    default:
      throw new Error(
        `Backend provider "${config.provider}" has no browser data layer. Set NEXT_PUBLIC_BACKEND_PROVIDER=supabase, ` +
          "and NEXT_PUBLIC_DATA_URL to move the data off Supabase.",
      );
  }
}

/** Server-only admin provisioner (null when service role key is unset). */
export function getAdminProvisioner(config: BackendConfig = readBackendConfig()): IAdminUserProvisioner | null {
  const { supabaseUrl, supabaseServiceRoleKey } = config;
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  return new SupabaseAdminUserProvisioner(supabaseUrl, supabaseServiceRoleKey);
}
