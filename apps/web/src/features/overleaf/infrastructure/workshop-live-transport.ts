import { closeLiveProject, emitLive, openLiveProject, takeLiveEvents } from "./workshop-live-client";
import type { WorkshopClientDeps } from "./workshop-session-client";

/**
 * The live link as the vendored Overleaf IDE's socket bridge reaches it
 * (`ol-host/io-bridge.ts`, `LiveTransport`): one Overleaf project, opened
 * through the workshop's live routes.
 */
export function workshopLiveTransport(deps: WorkshopClientDeps, sessionId: string, projectId: string) {
  return {
    async open() {
      const res = await openLiveProject(deps, sessionId, projectId);
      return res.ok
        ? { ok: true as const, liveId: res.liveId, join: res.join }
        : { ok: false as const, message: res.message };
    },
    emit: (liveId: string, name: string, args: unknown[]) => emitLive(deps, liveId, name, args),
    events: (liveId: string) => takeLiveEvents(deps, liveId),
    close: (liveId: string) => closeLiveProject(deps, liveId),
  };
}
