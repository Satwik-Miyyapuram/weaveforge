import type { Install097OldUserPort } from "../application/install-097-guard";
import { createWebOldUserPort } from "./install-097-web-port";
import { supabaseReads } from "./install-097-supabase-reads";

/**
 * The web old-user port for the signed-in account. Null when there is nothing to check: the
 * no-account copy, or nobody signed in. Modules load on demand so the gate's test graph stays small.
 */
export async function signedInWebPort(): Promise<Install097OldUserPort | null> {
  const { isLocalMode } = await import("@/features/auth/infrastructure/no-account-mode");
  if (isLocalMode()) return null;
  const { getDataClient } = await import("@/lib/parts");
  const client = getDataClient();
  // The local session, not a network call: a signed-out visitor is not an old user.
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user) return null;
  return createWebOldUserPort(supabaseReads(client), user.id);
}
