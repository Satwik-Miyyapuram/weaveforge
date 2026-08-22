import { createSupabaseClient } from "@/backend/providers/supabase/client";
import { readBackendConfig } from "@/backend/config";
import { syncEngine } from "./use-sync";
import type { AdoptionResult } from "../domain/adoption";

/**
 * The opt-in, performed.
 *
 * Loaded on demand rather than with the settings screen: this pulls in the
 * engine, the transport and the Supabase client, and a reader who never turns
 * sync on should never pay for any of it.
 */
export async function enableSync(): Promise<AdoptionResult> {
  const config = readBackendConfig();
  const client = createSupabaseClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "");
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("Sign in first, then turn sync on.");

  // The names the account already holds, so a first adoption that collides is
  // renamed rather than merged.
  const { data: remote } = await client.from("projects").select("name");
  const engine = syncEngine(async () => session.access_token);
  return engine.enable({
    accountId: session.user.id,
    remoteProjectNames: (remote ?? []).map((row: { name: string }) => row.name),
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
