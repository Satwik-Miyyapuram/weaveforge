/**
 * The handwriting helper's IPC, started on the first probe and kept for the
 * session.
 *
 * Extracted from `main.ts` so the shell's wiring stays apart from the
 * helper's door. Made lazily so a machine without the helper — every
 * non-Windows build — never pays for a spawn attempt until the page asks,
 * and the answer to `available` is then a plain `false` rather than a
 * rejection.
 */

import {
  createInkRecogniser,
  type InkHapticsMessage,
  type InkRecognitionRequest,
} from "./ink-recogniser";
import { CHANNELS } from "./channels";
import type { IpcSurface } from "./ipc-guard";

/** What the helper's door needs from the shell. */
export interface MainInkDeps {
  /** The guarded IPC, already pinned to the app's origin. */
  ipc: IpcSurface;
}

/** The helper's door: what it registers, and how it is closed. */
export interface MainInk {
  /** Stop the helper, if one was ever started, on the way out of the app. */
  dispose(): void;
}

export function registerMainInk(deps: MainInkDeps): MainInk {
  const { ipc } = deps;

  let inkRecogniser: ReturnType<typeof createInkRecogniser> | null = null;
  const inkHelper = () => (inkRecogniser ??= createInkRecogniser());

  ipc.handle(CHANNELS.inkAvailable, async () => {
    try {
      return { ok: true, value: await inkHelper().available() };
    } catch {
      return { ok: true, value: false };
    }
  });

  ipc.handle(CHANNELS.inkHapticsAvailable, async () => {
    try {
      return { ok: true, value: await inkHelper().hapticsAvailable() };
    } catch {
      return { ok: true, value: false };
    }
  });

  ipc.on(CHANNELS.inkHaptics, (_event, message: unknown) => {
    const body = message as Partial<InkHapticsMessage> | null;
    if (!body || typeof body.type !== "string") return;
    if (body.type === "update") {
      const pressure = Number((body as { pressure?: unknown }).pressure);
      const velocity = Number((body as { velocity?: unknown }).velocity);
      if (!Number.isFinite(pressure) || !Number.isFinite(velocity)) return;
      inkRecogniser?.haptics({ type: "update", pressure, velocity });
    } else if (body.type === "tool") {
      const tool = (body as { tool?: unknown }).tool;
      if (typeof tool === "string")
        inkRecogniser?.haptics({ type: "tool", tool: tool.slice(0, 32) });
    } else if (body.type === "stop") {
      inkRecogniser?.haptics({ type: "stop" });
    }
  });

  ipc.handle(CHANNELS.inkRecognise, async (_event, request: unknown) => {
    const body = request as Partial<InkRecognitionRequest> | null;
    if (!body || !Array.isArray(body.lines)) {
      return { ok: false, message: "That is not a page to recognise." };
    }
    try {
      return {
        ok: true,
        value: await inkHelper().recognise(body as InkRecognitionRequest),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "The handwriting recogniser did not answer.",
      };
    }
  });

  return {
    dispose: () => inkRecogniser?.dispose(),
  };
}
