import { coreIfReady } from "@/lib/rust-core";
import { getDataClient } from "@/lib/parts";
import { desktop } from "@/lib/desktop/desktop-bridge";
import type { BackendConfig } from "@/backend/parts";
import { gateOpfsSwitch } from "@/features/migration-097/application/opfs-switch-gate";
import { TABLE_BY_KIND } from "@/features/migration-097/infrastructure/postgrest-source";
import { wasmFileCodec } from "@/features/migration-097/infrastructure/wasm-codec";
import { workspaceFsAsSink } from "@/features/migration-097/infrastructure/workspace-fs-sink";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { decideBrowserSwitch, type SwitchDecision, type SwitchSession } from "./browser-export-switch";
import { openBrowserFileWiring, type BrowserFileWiring } from "./browser-file-backend";
import { readOrCreateInstallId } from "./browser-install-id";
import { openFilesIfSwitched, type MarkerProbe } from "./browser-switch-background";
import { localSwitchPending } from "./browser-readonly-fallback-098";
import { startSwitchRetryOnSignIn } from "./browser-switch-retry";
import { HttpBlobStore } from "@/storage/providers/http/http-blob-store";

/** Signed download URLs for the export's blob reads live for five minutes. */
const SIGNED_URL_TTL_SECONDS = 300;

/** Reads the signed-in user through the app's shared data client; null when nobody is signed in. */
function authSession(): () => Promise<SwitchSession | null> {
  // Looked up inside the returned getter: the switch reads it under its own error handling.
  return async () => {
    const { data } = await getDataClient().auth.getSession();
    const session = data.session;
    return session ? { userId: session.user.id, accessToken: session.access_token } : null;
  };
}

/**
 * Runs the fresh 0.9.8 switch decision from the live config. The Tauri shell is
 * desktop even when its bridge is missing, so the `__TAURI_INTERNALS__` global counts too.
 * Anything missing (wasm core, data URL, auth config) reads as "error", which keeps the server backend.
 */
export async function decideBrowserSwitchFromConfig(
  config: BackendConfig,
  shell: ReturnType<typeof desktop>,
): Promise<SwitchDecision> {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (shell !== null || inTauri) return { switch: false, reason: "desktop" };
  const core = coreIfReady();
  if (!core || !config.dataUrl || !config.supabaseUrl || !config.supabaseAnonKey) {
    return { switch: false, reason: "error" };
  }
  return decideBrowserSwitch({
    // Desktop returned above, so the switch's own desktop guard is always off here.
    desktop: false,
    session: authSession(),
    dataUrl: config.dataUrl,
    anonKey: config.supabaseAnonKey,
    signedUrl: async (bucket, path) =>
      (await new HttpBlobStore().signedUrls(bucket, [path], SIGNED_URL_TTL_SECONDS))[0] ?? null,
    kinds: Object.keys(TABLE_BY_KIND),
    codec: wasmFileCodec(core),
    openSink: async () => workspaceFsAsSink(await BrowserWorkspaceFs.openOpfs()),
    now: () => new Date().toISOString(),
    gate: gateOpfsSwitch,
    openWiring: openBrowserFileWiring,
    installId: async () => readOrCreateInstallId(await BrowserWorkspaceFs.openOpfs()),
    pending: localSwitchPending(),
  });
}

/**
 * Re-runs the switch when the user signs in while the retry banner shows, through the app's shared
 * auth client. Startup calls it once after `retrySwitch`; a second call is a no-op. Returns a stop function.
 */
export function watchSignInForSwitch(): () => void {
  return startSwitchRetryOnSignIn(getDataClient().auth);
}

/**
 * Startup probe for a browser that may already have switched. A present marker opens the files wiring
 * with no export (`opened`); no readable marker is `absent`. An OPFS that cannot open, or a marker whose
 * files do not open, is `failed`: the browser stays read-only rather than writing to the server. Never rejects.
 */
export async function openMarkedBrowserFiles(): Promise<MarkerProbe> {
  try {
    const fs = await BrowserWorkspaceFs.openOpfs();
    return await openFilesIfSwitched(workspaceFsAsSink(fs), await readOrCreateInstallId(fs), openBrowserFileWiring);
  } catch {
    return { state: "failed" };
  }
}