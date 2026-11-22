import {
  recordServerMarked,
  type ExportOptions,
} from "@/features/migration-097/application/run-web-export";
import { PostgrestSource } from "@/features/migration-097/infrastructure/postgrest-source";
import { writeSwitchMarker } from "@/features/migration-097/domain/switch-marker";
import type { BrowserFileWiring } from "./browser-file-backend";

/** The signed-in user the export reads for. Null means no session at startup. */
export type SwitchSession = { userId: string; accessToken: string };

export type SwitchDeps = {
  /** True inside the desktop app. The browser switch never runs there. */
  desktop: boolean;
  /** Test seam: the HTTP client the PostgREST source uses. Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  session: () => Promise<SwitchSession | null>;
  dataUrl: string;
  anonKey: string;
  /** Resolves a short-lived download URL for a blob; the export's fetchBlob needs it. */
  signedUrl?: (bucket: string, path: string) => Promise<string | null>;
  kinds: ExportOptions["kinds"];
  codec: ExportOptions["codec"];
  openSink: () => Promise<ExportOptions["sink"]>;
  now: () => string;
  /** Runs a fresh export and reports `switch` only when that run verified. */
  gate: (opts: ExportOptions) => Promise<{ switch: boolean }>;
  openWiring: () => Promise<BrowserFileWiring>;
  /** Reads or creates this browser's install id (readOrCreateInstallId). Keys its run and marker. */
  installId: () => Promise<string>;
  /**
   * P1 pending flag. Set once the server mark is written, cleared once the switch marker is written.
   * A switch left pending (marker write failed) makes the next start read-only, never server-writable.
   */
  pending?: { set(): void; clear(): void };
  /** Aborted at the background timeout. The export stops between files; an aborted switch never marks. */
  signal?: AbortSignal;
};

export type SwitchDecision =
  | { switch: true; wiring: BrowserFileWiring }
  | { switch: false; reason: "desktop" | "no-session" | "not-verified" | "error" };

/**
 * Decides, on every startup, whether this device uses OPFS files mode. The
 * export is re-run each time; the old folder report never decides the switch.
 * Any failure keeps the caller on the Retry path.
 */
export async function decideBrowserSwitch(deps: SwitchDeps): Promise<SwitchDecision> {
  if (deps.desktop) return { switch: false, reason: "desktop" };
  try {
    const session = await deps.session();
    if (!session) return { switch: false, reason: "no-session" };
    const source = new PostgrestSource({
      baseUrl: deps.dataUrl,
      userId: session.userId,
      fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
      // The browser has no local outbox: writes go straight to the server, so nothing waits in a
      // local queue and the count is a true 0. The static guard in test/browser-no-outbox.test.ts
      // fails if a browser-reachable module adds an outbox, so this count must be revisited then.
      pendingOutbox: async () => 0,
      signedUrl: deps.signedUrl,
      headers: {
        apikey: deps.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
    const sink = await deps.openSink();
    // This browser's install id: the only key for its own run in the report and its switch marker.
    const deviceId = await deps.installId();
    const outcome = await deps.gate({
      kinds: deps.kinds,
      codec: deps.codec,
      source,
      sink,
      now: deps.now(),
      runDeviceId: deviceId,
      // The export never writes the server mark itself. The mark is written below, after wiring opens.
      skipMark: true,
      signal: deps.signal,
    });
    // An abort that lands after a verified gate still stops here: no wiring, no server mark, no marker.
    if (!outcome.switch || deps.signal?.aborted) return { switch: false, reason: "not-verified" };
    const wiring = await deps.openWiring();
    if (deps.signal?.aborted) {
      // The timeout landed while the files opened: still no server mark and no marker.
      await wiring.close();
      return { switch: false, reason: "not-verified" };
    }
    try {
      await source.markExported097();
      deps.pending?.set();
      await recordServerMarked(sink, deviceId);
    } catch (err) {
      await wiring.close();
      throw err;
    }
    // Written last: a browser with this marker opens files directly on its next start.
    try {
      await writeSwitchMarker(sink, { switchedAt: deps.now(), deviceId });
    } catch (err) {
      await wiring.close();
      throw err;
    }
    deps.pending?.clear();
    return { switch: true, wiring };
  } catch {
    return { switch: false, reason: "error" };
  }
}