import type { SyncProvider } from "@/features/sync/domain/integration";
/**
 * How integrations rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface IntegrationRow {
  provider: SyncProvider;
  enabled: boolean;
  token: string | null;
  repo: string | null;
  branch: string | null;
}
