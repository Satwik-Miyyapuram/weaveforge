"use client";

import { useEffect, useState } from "react";

import { createDataClient } from "@/backend/providers/postgrest/parts-1";
import { readBackendConfig } from "@/backend/parts";
import { liveAccessToken } from "@/features/offline-sync/ui/enable-sync";
import { webPendingOutbox, webUpgradeFor, type WebUpgradeInputs } from "@/features/migration-097/application/web-upgrade-options";
import type { WebUpgradeRunnerOptions } from "@/features/migration-097/application/web-upgrade-runner";
import { MIGRATION_KINDS } from "@/features/migration-097/domain/report";
import { wasmFileCodec } from "@/features/migration-097/infrastructure/wasm-codec";
import { createMigrationWriters } from "@/features/migration-097/infrastructure/migration-writers";
import { workspaceFileSink } from "@/features/migration-097/infrastructure/workspace-file-sink";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { loadCore } from "@/lib/rust-core";
import { warnOnce } from "@/lib/error-report/parts";
import { useAuth } from "@/features/auth/ui/auth-provider";
import { InstallIdLocksUnavailableError, readOrCreateInstallId } from "@/container/browser-install-id";
import type { OpfsLike } from "@/features/migration-097/infrastructure/workspace-file-sink";
import { desktop } from "./desktop-bridge";
import { Migrate097Gate } from "./migrate-097-gate";

/** Set once a web export verifies, so a finished browser does not run the export again. */
export const WEB_EXPORTED_KEY = "weaveforge:web-097-exported";

export type WebCore = Awaited<ReturnType<typeof loadCore>>;
export type WebSession = Pick<WebUpgradeInputs, "baseUrl" | "userId" | "anonKey" | "accessToken">;

/** Where loadWebInputs gets each input. Tests replace these; the app uses the defaults. */
export interface WebInputSources {
  loadCore: () => Promise<WebCore>;
  makeCodec: (core: WebCore) => WebUpgradeInputs["codec"];
  /** The OPFS root: the sink needs writeTextIf, which the port's optional IWorkspaceFs method does not promise. */
  openFs: () => Promise<OpfsLike>;
  session: () => Promise<WebSession | null>;
}

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

/** The signed-in session's PostgREST base, anon key and live token. Null when there is no session. */
async function readWebSession(): Promise<WebSession | null> {
  const config = readBackendConfig();
  const client = createDataClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "");
  const { data, error } = await client.auth.getSession();
  if (error) warnOnce("migrate-097-web", "reading the session failed; the upgrade will not run", error);
  const userId = data.session?.user?.id;
  if (!userId) return null;
  return {
    baseUrl: `${config.dataUrl ?? config.supabaseUrl ?? ""}/rest/v1`,
    userId,
    anonKey: config.supabaseAnonKey ?? "",
    accessToken: liveAccessToken(client),
  };
}

const defaultWebInputSources: WebInputSources = {
  loadCore,
  makeCodec: (core) => wasmFileCodec(core, ""),
  openFs: () => BrowserWorkspaceFs.openOpfs(),
  session: readWebSession,
};

/**
 * The run id, or a run that fails with the WebView message when the browser has no Web Locks.
 * The failure is raised inside the run, so the upgrade screen shows it through onError.
 */
async function runIdentity(fs: OpfsLike): Promise<Pick<WebUpgradeInputs, "runDeviceId" | "run">> {
  try {
    return { runDeviceId: await readOrCreateInstallId(fs) };
  } catch (err) {
    if (!(err instanceof InstallIdLocksUnavailableError)) throw err;
    return { runDeviceId: "", run: () => Promise.reject(err) };
  }
}

/**
 * Everything the web export needs. Null when there is no session. The run id is the install id
 * browserReportOk reads from the same OPFS root, so the report written here is the one it checks.
 */
export async function loadWebInputs(sources: WebInputSources = defaultWebInputSources): Promise<WebUpgradeInputs | null> {
  // The core loads asynchronously; readyCore() throws until it does, so nothing touches it before.
  const core = await sources.loadCore();
  const session = await sources.session();
  if (!session) return null;
  const fs = await sources.openFs();
  const codec = sources.makeCodec(core);
  return {
    ...session,
    fetch: globalThis.fetch.bind(globalThis),
    sink: workspaceFileSink(fs),
    codec,
    kinds: MIGRATION_KINDS,
    // Notes, papers and comments go through the FILES repos; the wasm codec has no codec for them. The codec
    // finds the log entry, report section or reading list file a comment sits next to. Every other kind without
    // a codec is archived losslessly under .weaveforge/migration-0.9.7/archive/ (and written to its file home).
    writers: (sink) => createMigrationWriters(sink, codec, undefined, (kind, _row, err) =>
      warnOnce("migrate-097-web", `a ${kind} row stayed in the archive only`, err),
    ),
    pendingOutbox: webPendingOutbox,
    now: new Date().toISOString(),
    ...(await runIdentity(fs)),
    onVerified: () => writeFlag(WEB_EXPORTED_KEY, "1"),
    alreadyDone: () => readFlag(WEB_EXPORTED_KEY) !== null,
  };
}

type WebUpgradeLoader = () => Promise<WebUpgradeInputs | null>;
const defaultWebUpgradeLoader: WebUpgradeLoader = () => loadWebInputs();

/**
 * Mounts the migration gate for the web app. The web export runs only in a browser
 * with a signed-in session and no completion marker, and never inside the desktop shell.
 */
export function Migrate097Web({ children, load = defaultWebUpgradeLoader }: { children: React.ReactNode; load?: WebUpgradeLoader }) {
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
    void load()
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
  }, [userId, loading, load]);

  return <Migrate097Gate webUpgrade={webUpgrade}>{children}</Migrate097Gate>;
}
