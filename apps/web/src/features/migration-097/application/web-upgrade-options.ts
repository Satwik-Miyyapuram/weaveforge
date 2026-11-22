import type { FileCodec, FileSink } from "../domain/ports";
import { authedFetch } from "../infrastructure/authed-fetch";
import type { WebUpgradeRunnerOptions, WebUpgradeRun } from "./web-upgrade-runner";
import { runWebUpgrade } from "./run-web-upgrade";

/** What the browser supplies to the web export. Built once the session is known. */
export interface WebUpgradeInputs {
  /** PostgREST base, e.g. `${dataUrl}/rest/v1`. */
  baseUrl: string;
  userId: string;
  anonKey: string;
  /** Read per request; see liveAccessToken. */
  accessToken: () => Promise<string | null>;
  fetch: typeof fetch;
  sink: FileSink;
  codec: FileCodec;
  kinds: readonly string[];
  pendingOutbox: () => Promise<number>;
  now: string;
  runDeviceId: string;
  /** Called after a verified run, before the screen reloads. Sets the per-browser completion marker. */
  onVerified?: () => void;
  run?: WebUpgradeRun;
}

/**
 * The web keeps no local sync outbox: sync runs only in the desktop shell (see the
 * `desktop()` gate in offline-sync/ui/use-sync-issues.ts), so no unsent ops exist here.
 */
export async function webPendingOutbox(): Promise<number> {
  return 0;
}

/**
 * Web runner options, or null. Desktop never gets a web runner (it uses the shell's
 * exporter), and neither does a browser without a signed-in session.
 */
export function webUpgradeFor(isDesktop: boolean, inputs: WebUpgradeInputs | null): WebUpgradeRunnerOptions | null {
  if (isDesktop || !inputs) return null;
  const inner = inputs.run ?? runWebUpgrade;
  return {
    server: {
      baseUrl: inputs.baseUrl,
      userId: inputs.userId,
      fetch: authedFetch(inputs.baseUrl, inputs.accessToken, inputs.fetch),
      headers: { apikey: inputs.anonKey },
    },
    kinds: inputs.kinds,
    codec: inputs.codec,
    sink: inputs.sink,
    now: inputs.now,
    runDeviceId: inputs.runDeviceId,
    pendingOutbox: inputs.pendingOutbox,
    run: async (opts, onProgress) => {
      const result = await inner(opts, onProgress);
      if (result.state === "verified") inputs.onVerified?.();
      return result;
    },
  };
}
