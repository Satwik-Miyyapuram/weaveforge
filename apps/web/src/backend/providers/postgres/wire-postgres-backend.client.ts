/**
 * Browser stub — the Postgres provider uses `pg` (Node-only). Client code must keep
 * NEXT_PUBLIC_BACKEND_PROVIDER=supabase until a server API layer exists (Phase 5).
 */
import type { BackendConfig } from "@/backend/config";
import type { ProjectContext } from "@/lib/project-context";
import type { WiredSupabaseBackend } from "../supabase/wire-supabase-backend";

export type WiredPostgresBackend = WiredSupabaseBackend;

export function wirePostgresBackend(
  _config: BackendConfig,
  _projectContext: ProjectContext,
  _pid: () => string | null,
): WiredPostgresBackend {
  throw new Error(
    "Postgres backend is server-only (pg pool). Keep NEXT_PUBLIC_BACKEND_PROVIDER=supabase for the browser bundle; " +
      "use postgres on the server (API routes) or after Phase 5 cutover wiring.",
  );
}
