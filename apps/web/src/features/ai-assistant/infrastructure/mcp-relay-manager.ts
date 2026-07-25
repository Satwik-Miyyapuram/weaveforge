import type { AiAccessSettings } from "@thesis/core";
import { startMcpBrowserRelay } from "./mcp-browser-relay";

/**
 * Process-wide registry of running browser relays, keyed by session id. Living
 * outside React means the relay keeps polling while the settings modal is
 * closed, and reopening (or a reload rehydration) never spawns a duplicate loop
 * for a session already being serviced.
 */
interface RelayEntry {
  secret: string;
  settings: AiAccessSettings;
  stop: () => void;
}

export type McpRelayStarter = (input: { sessionId: string; pairingSecret: string; settings: AiAccessSettings }) => () => void;

/** Isolated manager factory keeps relay lifecycle testable without browser APIs. */
export function createMcpRelayManager(start: McpRelayStarter = startMcpBrowserRelay) {
  const managedRelays = new Map<string, RelayEntry>();
  return {
    ensureRelay(sessionId: string, secret: string, settings: AiAccessSettings): void {
      if (managedRelays.has(sessionId)) return;
      const stop = start({ sessionId, pairingSecret: secret, settings });
      managedRelays.set(sessionId, { secret, settings, stop });
    },
    stopRelay(sessionId: string): void {
      managedRelays.get(sessionId)?.stop();
      managedRelays.delete(sessionId);
    },
    stopAllRelays(): void {
      for (const entry of managedRelays.values()) entry.stop();
      managedRelays.clear();
    },
    runningRelays(): { sessionId: string; secret: string; settings: AiAccessSettings }[] {
      return [...managedRelays.entries()].map(([sessionId, { secret, settings }]) => ({ sessionId, secret, settings }));
    },
  };
}

const defaultManager = createMcpRelayManager();

/** Start a relay for the session, or no-op if one is already running. */
export function ensureRelay(sessionId: string, secret: string, settings: AiAccessSettings): void {
  defaultManager.ensureRelay(sessionId, secret, settings);
}

export function stopRelay(sessionId: string): void {
  defaultManager.stopRelay(sessionId);
}

export function stopAllRelays(): void {
  defaultManager.stopAllRelays();
}

/** Secret + settings for each running relay, for re-persisting the session set. */
export function runningRelays(): { sessionId: string; secret: string; settings: AiAccessSettings }[] {
  return defaultManager.runningRelays();
}
