/**
 * The two `@tauri-apps/api` calls the shell bridge needs, without the package.
 * Talks to the injected `__TAURI_INTERNALS__` directly, as the package does.
 */

/** The part of Tauri's injected `__TAURI_INTERNALS__` this file uses. */
export interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Registers a callback Tauri can call by the returned id. */
  transformCallback(cb: (event: { payload: unknown }) => void, once?: boolean): number;
}

/** `invoke` and `listen` bound to the given internals; the internals are a parameter so tests can fake them. */
export function tauriCore(internals: TauriInternals | undefined) {
  /** Calls a Tauri command; rejects when the internals are missing. */
  async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!internals) throw new Error("Tauri internals are missing");
    return (await internals.invoke(cmd, args)) as T;
  }
  /** Subscribes to a shell event; resolves to the way to stop listening. */
  async function listenEvent(
    event: string,
    handler: (payload: unknown) => void,
  ): Promise<() => void> {
    if (!internals) throw new Error("Tauri internals are missing");
    const handlerId = internals.transformCallback((e) => handler(e.payload));
    const eventId = await invokeCmd<number>("plugin:event|listen", {
      event,
      target: { kind: "Any" },
      handler: handlerId,
    });
    return () => {
      void invokeCmd("plugin:event|unlisten", { event, eventId });
    };
  }
  return { invoke: invokeCmd, listen: listenEvent };
}

/** The injected internals, read per call so a late injection still works. */
function currentInternals(): TauriInternals | undefined {
  return (globalThis as { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
}

/** Calls a Tauri command, as `@tauri-apps/api/core` `invoke` does. */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriCore(currentInternals()).invoke<T>(cmd, args);
}

/** Subscribes to a shell event, as `@tauri-apps/api/event` `listen` does. */
export function listen(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  return tauriCore(currentInternals()).listen(event, handler);
}
