import type { SupabaseClient } from "@supabase/supabase-js";
import type { Install097OldUserPort } from "../application/install-097-guard";
import { createWebOldUserPort } from "./install-097-web-port";
import { supabaseReads } from "./install-097-supabase-reads";

/** What the signed-in check needs from the app: the copy's mode and its data client. */
export interface SignedInSource {
  isLocalMode(): boolean;
  client(): SupabaseClient;
}

/** Modules load on demand so the gate's test graph stays small. */
async function loadAppSource(): Promise<SignedInSource> {
  const { isLocalMode } = await import("@/features/auth/infrastructure/no-account-mode");
  const { getDataClient } = await import("@/lib/parts");
  return { isLocalMode, client: getDataClient };
}

/**
 * The web old-user port for the signed-in account. Null when there is nothing to check: the
 * no-account copy, or nobody signed in.
 */
export async function signedInWebPort(load: () => Promise<SignedInSource> = loadAppSource): Promise<Install097OldUserPort | null> {
  const source = await load();
  if (source.isLocalMode()) return null;
  const client = source.client();
  // The local session, not a network call: a signed-out visitor is not an old user.
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user) return null;
  return createWebOldUserPort(supabaseReads(client), user.id);
}
