import type { BackendConfig } from "./config";
import { readBackendConfig } from "./config";
import type { IAdminUserProvisioner } from "@thesis/core";
import { SupabaseAdminUserProvisioner } from "./providers/supabase/admin-provisioner";
// The real postgres wiring pulls in `pg` (Node-only; its deps need `fs`), which
// breaks the SSR compilation of every client component that reaches this module
// through @/bootstrap ("Element type is invalid ... got: undefined" on all
// routes). wireBackend() only runs in the browser container, so always use the
// browser stub here; server code (e.g. storage/server/blob-api.ts) imports the
// real postgres modules directly.
import { wirePostgresBackend, type WiredPostgresBackend } from "./providers/postgres/wire-postgres-backend.client";
import { wireSupabaseBackend, type WiredSupabaseBackend } from "./providers/supabase/wire-supabase-backend";

export type WiredBackend = WiredSupabaseBackend | WiredPostgresBackend;

export function wireBackend(
  config: BackendConfig = readBackendConfig(),
  projectContext = { projectId: null as string | null },
  pid: () => string | null = () => projectContext.projectId,
): WiredBackend {
  switch (config.provider) {
    case "supabase":
      return wireSupabaseBackend(config, projectContext, pid);
    case "postgres":
      return wirePostgresBackend(config, projectContext, pid);
    default:
      throw new Error(
        `Unknown backend provider "${config.provider}". Set NEXT_PUBLIC_BACKEND_PROVIDER=supabase.`,
      );
  }
}

/** Server-only admin provisioner (null when service role key is unset). */
export function getAdminProvisioner(config: BackendConfig = readBackendConfig()): IAdminUserProvisioner | null {
  const { supabaseUrl, supabaseServiceRoleKey } = config;
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  return new SupabaseAdminUserProvisioner(supabaseUrl, supabaseServiceRoleKey);
}
