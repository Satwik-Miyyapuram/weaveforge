import type { ExportOptions } from "@/features/migration-097/application/run-web-export";
import { PostgrestSource } from "@/features/migration-097/infrastructure/postgrest-source";
import type { BrowserFileWiring } from "./browser-file-backend";

/** The signed-in user the export reads for. Null means no session at startup. */
export type SwitchSession = { userId: string; accessToken: string };

export type SwitchDeps = {
  session: () => Promise<SwitchSession | null>;
  dataUrl: string;
  anonKey: string;
  kinds: ExportOptions["kinds"];
  codec: ExportOptions["codec"];
  openSink: () => Promise<ExportOptions["sink"]>;
  now: () => string;
  /** Runs a fresh export and reports `switch` only when that run verified. */
  gate: (opts: ExportOptions) => Promise<{ switch: boolean }>;
  openWiring: () => Promise<BrowserFileWiring>;
};

export type SwitchDecision =
  | { switch: true; wiring: BrowserFileWiring }
  | { switch: false; reason: "no-session" | "not-verified" | "error" };

/**
 * Decides, on every startup, whether this device uses OPFS files mode. The
 * export is re-run each time; the old folder report never decides the switch.
 * Any failure keeps the caller on the Retry path.
 */
export async function decideBrowserSwitch(deps: SwitchDeps): Promise<SwitchDecision> {
  try {
    const session = await deps.session();
    if (!session) return { switch: false, reason: "no-session" };
    const source = new PostgrestSource({
      baseUrl: deps.dataUrl,
      userId: session.userId,
      fetch: globalThis.fetch.bind(globalThis),
      headers: {
        apikey: deps.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
    const sink = await deps.openSink();
    const outcome = await deps.gate({
      kinds: deps.kinds,
      codec: deps.codec,
      source,
      sink,
      now: deps.now(),
    });
    if (!outcome.switch) return { switch: false, reason: "not-verified" };
    return { switch: true, wiring: await deps.openWiring() };
  } catch {
    return { switch: false, reason: "error" };
  }
}