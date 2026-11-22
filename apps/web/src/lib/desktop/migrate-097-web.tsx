"use client";

import { useEffect, useState } from "react";

import { createDataClient } from "@/backend/providers/postgrest/parts-1";
import { readBackendConfig } from "@/backend/parts";
import { liveAccessToken } from "@/features/offline-sync/ui/enable-sync";
import { webPendingOutbox, webUpgradeFor, type WebUpgradeInputs } from "@/features/migration-097/application/web-upgrade-options";
import type { WebUpgradeRunnerOptions } from "@/features/migration-097/application/web-upgrade-runner";
import { MIGRATION_KINDS } from "@/features/migration-097/domain/report";
import { wasmFileCodec } from "@/features/migration-097/infrastructure/wasm-codec";
import { workspaceFileSink } from "@/features/migration-097/infrastructure/workspace-file-sink";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { loadCore } from "@/lib/rust-core";
import { warnOnce } from "@/lib/error-report/parts";
import { useAuth } from "@/features/auth/ui/auth-provider";
import { desktop } from "./desktop-bridge";
import { Migrate097Gate } from "./migrate-097-gate";

/** Set once a web export verifies, so a finished browser does not run the export again. */
export const WEB_EXPORTED_KEY = "weaveforge:web-097-exported";
const DEVICE_KEY = "weaveforge:run-device-id";

function readFlag(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the export simply runs again next load.
  }
}

function runDeviceId(): string {
  const existing = readFlag(DEVICE_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `dev-${Date.now()}`;
  writeFlag(DEVICE_KEY, id);
  return id;
}

/** Everything the web export needs, read from the signed-in session. Null when there is no session. */
async function loadWebInputs(): Promise<WebUpgradeInputs | null> {
  const config = readBackendConfig();
  const client = createDataClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "");
  const { data, error } = await client.auth.getSession();
  if (error) warnOnce("migrate-097-web", "reading the session failed; the upgrade will not run", error);
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const sink = workspaceFileSink(await BrowserWorkspaceFs.openOpfs());
  // The core loads asynchronously; readyCore() throws until it does, so wait for it first.
  const core = await loadCore();
  return {
    baseUrl: `${config.dataUrl ?? config.supabaseUrl ?? ""}/rest/v1`,
    userId,
    anonKey: config.supabaseAnonKey ?? "",
    accessToken: liveAccessToken(client),
    fetch: globalThis.fetch.bind(globalThis),
    sink,
    codec: wasmFileCodec(core, ""),
    kinds: MIGRATION_KINDS,
    pendingOutbox: webPendingOutbox,
    now: new Date().toISOString(),
    runDeviceId: runDeviceId(),
    onVerified: () => writeFlag(WEB_EXPORTED_KEY, "1"),
  };
}

/**
 * Mounts the migration gate for the web app. The web export runs only in a browser
 * with a signed-in session and no completion marker, and never inside the desktop shell.
 */
export function Migrate097Web({ children }: { children: React.ReactNode }) {
  const [webUpgrade, setWebUpgrade] = useState<WebUpgradeRunnerOptions | null>(null);
  // Read from the auth provider so a user who signs in after first paint gets a runner.
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading || desktop() || readFlag(WEB_EXPORTED_KEY)) return;
    if (!userId) {
      setWebUpgrade(null);
      return;
    }
    let alive = true;
    void loadWebInputs()
      .then((inputs) => {
        if (alive) setWebUpgrade(webUpgradeFor(false, inputs));
      })
      .catch((err: unknown) => {
        // No workspace or no core: the app loads without the upgrade screen.
        warnOnce("migrate-097-web", "the web upgrade could not start", err);
      });
    return () => {
      alive = false;
    };
  }, [userId, loading]);

  return <Migrate097Gate webUpgrade={webUpgrade}>{children}</Migrate097Gate>;
}
