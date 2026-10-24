import { createDataClient } from "@/backend/providers/postgrest/client";
import { readBackendConfig } from "@/backend/config";
import { syncEngine } from "./use-sync";
import type { AdoptionResult } from "../domain/adoption";

/**
 * A **fresh** access token per request.
 *
 * This replaces a closure over `session.access_token`, read once when the reader
 * pressed the button. An access token lasts about an hour, so every request after
 * that — the pump during a long adoption, and every cycle once the loop runs —
 * carried a token the server had already retired. The engine's `reauth` outcome,
 * which exists precisely to tell "the credential, not the network" apart, could
 * never fire, because the transport never asked for a new one.
 *
 * It takes the client rather than reaching for it so that what it does can be
 * tested without a network: the property that matters is *when* it reads.
 */
export function liveAccessToken(client: {
  auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }> };
}): () => Promise<string | null> {
  return async () => {
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  };
}

/**
 * The account's project names, so a first adoption that collides is renamed
 * rather than merged. A failed read rejects: adopting without the names would
 * merge a colliding project, and the sync loop retries the boot instead.
 */
export async function remoteProjectNames(client: {
  from: (table: string) => {
    select: (columns: string) => PromiseLike<{ data: { name: string }[] | null; error: { message: string } | null }>;
  };
}): Promise<string[]> {
  const { data, error } = await client.from("projects").select("name");
  if (error) throw new Error(`Could not read this account's projects: ${error.message}`);
  return (data ?? []).map((row) => row.name);
}

/**
 * Adopt this device's local work into the signed-in account.
 *
 * Run by the sync loop when a session first signs in, and by the settings
 * panel. Loaded on demand: it pulls in the engine, the transport and the data
 * client, which a window that never signs in should not pay for.
 */
export async function enableSync(): Promise<AdoptionResult> {
  const config = readBackendConfig();
  const client = createDataClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "");
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("Sign in first, then turn sync on.");

  const names = await remoteProjectNames(client);
  const engine = syncEngine(liveAccessToken(client));
  return engine.enable({
    accountId: session.user.id,
    remoteProjectNames: names,
    deviceLabel: deviceLabel(),
  });
}

/** How the reader knows this machine: "which laptop was that?" is answerable. */
function deviceLabel(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  if (/mac/i.test(platform)) return "Mac";
  if (/win/i.test(platform)) return "Windows";
  if (/linux/i.test(platform)) return "Linux";
  return "this device";
}
