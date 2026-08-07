import type { AiAccessSettings } from "@weaveforge/core";
import { startMcpBrowserRelay } from "./mcp-browser-relay";

/**
 * Process-wide registry of running browser relays, keyed by session id. Living
 * outside React means the relay keeps polling while the settings modal is
 * closed, and reopening (or a reload rehydration) never spawns a duplicate loop
 * for a session already being serviced.
 */
interface RelayEntry {
  secret: string;
  /** Mutable box so mid-session `ensureRelay` refreshes policy without restart. */
  settingsRef: { current: AiAccessSettings };
  stop: () => void;
}

export type McpRelayStarter = (input: {
  sessionId: string;
  pairingSecret: string;
  getSettings: () => AiAccessSettings;
}) => () => void;

/** Isolated manager factory keeps relay lifecycle testable without browser APIs. */
export function createMcpRelayManager(start: McpRelayStarter = startMcpBrowserRelay) {
  const managedRelays = new Map<string, RelayEntry>();
  return {
    ensureRelay(sessionId: string, secret: string, settings: AiAccessSettings): void {
      const existing = managedRelays.get(sessionId);
      if (existing) {
        existing.settingsRef.current = settings;
        return;
      }
      const settingsRef = { current: settings };
      const stop = start({
        sessionId,
        pairingSecret: secret,
        getSettings: () => settingsRef.current,
      });
      managedRelays.set(sessionId, { secret, settingsRef, stop });
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
      return [...managedRelays.entries()].map(([sessionId, { secret, settingsRef }]) => ({
        sessionId,
        secret,
        settings: settingsRef.current,
      }));
    },
  };
}

const defaultManager = createMcpRelayManager();

/** Start a relay for the session, or refresh settings if one is already running. */
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
