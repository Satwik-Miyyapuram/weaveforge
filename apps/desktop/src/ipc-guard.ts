import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

/**
 * Who is allowed to call the shell.
 *
 * The window loads the WeaveForge web app, and the preload beside it exposes a
 * bridge that reaches raw SQL, the workspace folder, the keychain and the
 * loopback API's switch. Every one of those is something a page must not be
 * able to ask for on behalf of somebody else, so the question "which origin is
 * asking" has to be answered before any handler runs.
 *
 * The navigation guard in `main.ts` is the first line of this defence, and it
 * is a good one: it keeps the window pointed at the app. It is also the *only*
 * one, which is the problem. Two supported configurations break the assumption
 * it rests on — `WEAVEFORGE_URL` points the window at a dev server, and a shell
 * built with a `__DEFAULT_APP_URL__` that is not the operator's own deployment
 * loads a page that is not ours. Both are one environment variable or one build
 * flag away, and neither would be noticed until something acted on it.
 *
 * So the check is repeated at the boundary itself, which is where it belongs:
 * a handler that reads the workspace folder should not have to trust that the
 * only frame that loads is the right one. It should ask.
 *
 * Nothing here is Electron-specific beyond the event shape. The `ipc` object is
 * injected for the same reason `handlers.ts` keeps Electron out of itself: so
 * the rule can be run in a test without an app.
 */

/**
 * Electron's own parameter types, borrowed rather than restated.
 *
 * An `ipcMain` listener's first argument is an event that differs between
 * `handle` and `on`, and both carry `senderFrame`. Writing the shapes out by
 * hand would be a second definition to keep in step with Electron's; the two
 * types are erased at build time, so importing them costs nothing at runtime.
 */
export type GuardedEvent = IpcMainInvokeEvent | IpcMainEvent;

/** Something that can answer a renderer's request, or listen for its news. */
export interface IpcSurface {
  handle(
    channel: string,
    listener: (event: GuardedEvent, ...args: unknown[]) => unknown,
  ): void;
  on(channel: string, listener: (event: GuardedEvent, ...args: unknown[]) => void): void;
}

/**
 * Whether a URL belongs to the app.
 *
 * Compared by component — scheme, host, port — rather than by `URL.origin`,
 * which is *not* usable here and is the reason this is a function at all. The
 * app is served from `app://`, a scheme Chromium gives a real origin
 * (`app://weaveforge`) because `main.ts` registers it as standard, but Node's
 * `URL` follows the WHATWG rule for non-special schemes and reports `"null"`.
 * Comparing the two would refuse every legitimate call. The components are
 * parsed identically by both, so they are what is compared.
 *
 * Anything unparseable counts as "no": a URL this cannot read is not one the
 * shell should act for, and treating a parse failure as a pass would make the
 * guard fail open on exactly the input it exists to reject.
 */
export function sameOrigin(url: string, origin: string): boolean {
  const there = parts(url);
  const here = parts(origin);
  return there !== null && here !== null && sameOriginParts(there, here);
}

/**
 * The origin of a URL, spelled the way `sameOrigin` can read it back.
 *
 * `new URL("app://weaveforge/").origin` is the string `"null"` in Node, for
 * the reason above, and a guard handed `"null"` refuses its own window on the
 * first call. This is the one way to turn the window's URL into an origin.
 */
export function originOf(url: string): string {
  const p = parts(url);
  if (!p) throw new Error(`Not a URL: ${url}`);
  return `${p.protocol}//${p.hostname}${p.port ? `:${p.port}` : ""}`;
}

interface OriginParts {
  protocol: string;
  hostname: string;
  port: string;
}

function parts(url: string): OriginParts | null {
  try {
    const parsed = new URL(url);
    return { protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port };
  } catch {
    return null;
  }
}

function sameOriginParts(a: OriginParts, b: OriginParts): boolean {
  // The hostname is folded because it is case-insensitive, and Node only folds
  // it for the schemes the URL standard calls special: `http://App.Example/`
  // arrives lowercased, `app://WeaveForge/` does not. Without this, a build
  // whose `__DEFAULT_APP_URL__` had a capital letter would refuse its own
  // window. The scheme is compared as parsed, where both sides agree.
  return (
    a.protocol === b.protocol &&
    a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
    effectivePort(a) === effectivePort(b)
  );
}

/**
 * The port that would be named if the URL had spelled it out.
 *
 * `https://x/` and `https://x:443/` are the same origin, and the same goes for
 * http and the loopback development server. Comparing the raw `port` would call
 * those different, which for a check like this is the wrong way to be wrong:
 * a legitimate build would be refused.
 */
function effectivePort(where: OriginParts): string {
  if (where.port) return where.port;
  return DEFAULT_PORTS[where.protocol] ?? where.protocol;
}

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
  "ws:": "80",
  "wss:": "443",
  "ftp:": "21",
};

/**
 * The door every channel is registered through.
 *
 * `handle` answers a request and `on` receives an event; both are refused the
 * same way and for the same reason. A refusal is an ordinary `Error`, which is
 * what `ipcMain.handle` already turns into a rejected promise on the caller's
 * side — so a page that is not ours gets a failed call and no behaviour, which
 * is the outcome wanted. It is deliberately not a silent no-op: a handler that
 * never ran and never said so is an afternoon spent debugging a misconfigured
 * `WEAVEFORGE_URL`.
 */
export function registerGuardedIpc(allowedOrigin: string, ipc: IpcSurface) {
  /**
   * The origin check, in one place, with the log line a misconfiguration needs.
   *
   * `senderFrame` is absent on a message that did not come from a frame at all,
   * and is null once the frame that sent one has gone away. Neither is a caller
   * this app has a reason to serve, so both are refused rather than waved
   * through — and `sameOrigin` refuses a URL it cannot parse for the same
   * reason.
   */
  function permitted(channel: string, event: GuardedEvent): string | null {
    const url = event.senderFrame?.url;
    if (!url) return "it did not come from a frame";
    if (sameOrigin(url, allowedOrigin)) return null;
    const seen = parts(url);
    return `it came from ${seen ? `${seen.protocol}//${seen.hostname}` : "an address that could not be read"}`;
  }

  return {
    handle(
      channel: string,
      listener: (event: GuardedEvent, ...args: unknown[]) => unknown,
    ): void {
      ipc.handle(channel, (event: GuardedEvent, ...args: unknown[]) => {
        const reason = permitted(channel, event);
        if (reason) return refuse(channel, reason);
        return listener(event, ...args);
      });
    },

    on(channel: string, listener: (event: GuardedEvent, ...args: unknown[]) => void): void {
      ipc.on(channel, (event: GuardedEvent, ...args: unknown[]) => {
        const reason = permitted(channel, event);
        if (reason) {
          // Logged, not raised. `handle` has a caller waiting for an answer
          // and the throw becomes its rejection; `on` is fire-and-forget, and
          // an exception here would surface as an unhandled error in the main
          // process. The listener simply does not run, which is the whole of
          // what a refused event should mean.
          log(channel, reason);
          return;
        }
        listener(event, ...args);
      });
    },
  };
}

/**
 * One short line, then the failure.
 *
 * The line is the diagnostic: the usual cause is a `WEAVEFORGE_URL` or a
 * `__DEFAULT_APP_URL__` that does not match the build, and without it the shell
 * looks broken in a way nothing else explains. Short on purpose — this runs
 * once per refused call, and a page that is not ours is not owed a paragraph.
 */
function log(channel: string, reason: string): void {
  console.warn(`[ipc] refused ${channel}: ${reason}. The window is not on the app's origin.`);
}

/** The same line, and then the failure the caller gets to see. */
function refuse(channel: string, reason: string): never {
  log(channel, reason);
  throw new Error("That call did not come from the WeaveForge window.");
}
