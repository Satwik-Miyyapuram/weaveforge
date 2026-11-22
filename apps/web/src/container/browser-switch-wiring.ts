import { createClient } from "@supabase/supabase-js";
import { coreIfReady } from "@/lib/rust-core";
import type { BackendConfig } from "@/backend/parts";
import { gateOpfsSwitch } from "@/features/migration-097/application/opfs-switch-gate";
import { TABLE_BY_KIND } from "@/features/migration-097/infrastructure/postgrest-source";
import { wasmFileCodec } from "@/features/migration-097/infrastructure/wasm-codec";
import { workspaceFsAsSink } from "@/features/migration-097/infrastructure/workspace-fs-sink";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { decideBrowserSwitch, type SwitchDecision, type SwitchSession } from "./browser-export-switch";
import { openBrowserFileWiring } from "./browser-file-backend";

/** Reads the signed-in user from Supabase Auth; null when nobody is signed in. */
function authSession(config: BackendConfig): () => Promise<SwitchSession | null> {
  const auth = createClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "").auth;
  return async () => {
    const { data } = await auth.getSession();
    const session = data.session;
    return session ? { userId: session.user.id, accessToken: session.access_token } : null;
  };
}

/**
 * Runs the fresh 0.9.8 switch decision from the live config. Anything missing
 * (wasm core, data URL, auth config) reads as "error", which keeps the server backend.
 */
export async function decideBrowserSwitchFromConfig(config: BackendConfig): Promise<SwitchDecision> {
  const core = coreIfReady();
  if (!core || !config.dataUrl || !config.supabaseUrl || !config.supabaseAnonKey) {
    return { switch: false, reason: "error" };
  }
  return decideBrowserSwitch({
    session: authSession(config),
    dataUrl: config.dataUrl,
    anonKey: config.supabaseAnonKey,
    kinds: Object.keys(TABLE_BY_KIND),
    codec: wasmFileCodec(core),
    openSink: async () => workspaceFsAsSink(await BrowserWorkspaceFs.openOpfs()),
    now: () => new Date().toISOString(),
    gate: gateOpfsSwitch,
    openWiring: openBrowserFileWiring,
  });
}