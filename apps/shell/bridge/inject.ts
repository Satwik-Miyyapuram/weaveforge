/**
 * Builds `window.weaveforge` for the Tauri shell and installs it on the main
 * window. The shell defines `__WEAVEFORGE_SHELL__` before this bundle runs.
 */

import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { localDbBridge, unwrap, type LocalDbCommands } from "./bridge";
import {
  desktopShim,
  type DesktopCommands,
  type DesktopEvents,
} from "./desktop";
import type { commands } from "./bindings";
import { listen } from "./tauri-core";

/** The generated menu and window commands this file calls. */
type MenuCommands = Pick<
  typeof commands,
  "menuModel" | "menuInvoke" | "titleBarColors" | "windowFocus"
>;

/** Every generated command this file hands to the bridge parts. */
type BridgeCommands = DesktopCommands & LocalDbCommands & MenuCommands;

/** What the shell tells the page about itself. */
export interface ShellInfo {
  version: string;
  platform: "darwin" | "win32" | "linux";
}

/** The event the shell emits with a sign-in link's query string. */
export const SIGN_IN_EVENT = "sign-in";

/**
 * Holds the newest sign-in that arrived while nobody listened and hands it to
 * the next subscriber, once. Live sign-ins go straight to the listeners.
 */
export function createSignInInbox() {
  const listeners = new Set<(query: string) => void>();
  let pending: string | null = null;
  return {
    deliver(query: string): void {
      if (listeners.size === 0) pending = query;
      else for (const listener of listeners) listener(query);
    },
    subscribe(listener: (query: string) => void): () => void {
      listeners.add(listener);
      if (pending !== null) {
        const query = pending;
        pending = null;
        listener(query);
      }
      return () => listeners.delete(listener);
    },
  };
}

/** Wraps the generated commands and shell events as `window.weaveforge`. */
export function desktopBridge(
  cmds: BridgeCommands,
  events: DesktopEvents,
  info: ShellInfo,
): DesktopBridge {
  // One shell listener for the page's life, so a late subscriber gets the pending sign-in.
  const inbox = createSignInInbox();
  void events
    .listen(SIGN_IN_EVENT, (payload) => {
      if (typeof payload === "string") inbox.deliver(payload);
    })
    .catch((error: unknown) => {
      console.warn("Sign-in links will not reach the page:", error);
    });
  return {
    version: info.version,
    platform: info.platform,
    ...localDbBridge(cmds),
    ...desktopShim(cmds, events),
    onSignIn: (cb) => inbox.subscribe(cb),
    menuModel: async () => unwrap(await cmds.menuModel()),
    invokeMenuItem: async (id) => {
      unwrap(await cmds.menuInvoke(id));
    },
    // Fire and forget, like the Electron ipc send: a failed colour set is logged.
    setTitleBarColors: ({ background, ink }) => {
      void cmds
        .titleBarColors(background, ink)
        .then((reply) => unwrap(reply))
        .catch((error: unknown) => {
          console.warn("The title bar colours were not set:", error);
        });
    },
    setWindowFocus: (on) => {
      void cmds
        .windowFocus(on)
        .then((reply) => unwrap(reply))
        .catch((error: unknown) => {
          console.warn("The window focus was not set:", error);
        });
    },
  };
}

/** Sets `target.weaveforge` unless the page already has one. */
export function install(
  target: { weaveforge?: DesktopBridge },
  info: ShellInfo,
  deps: { commands: BridgeCommands; listen: DesktopEvents["listen"] },
): void {
  if (target.weaveforge) return;
  target.weaveforge = desktopBridge(deps.commands, { listen: deps.listen }, info);
}

const shellInfo = (globalThis as { __WEAVEFORGE_SHELL__?: ShellInfo })
  .__WEAVEFORGE_SHELL__;
if (shellInfo) {
  // Loaded on demand so importing this file in tests never loads the generated bindings.
  void import("./bindings").then(({ commands: generated }) =>
    install(globalThis as { weaveforge?: DesktopBridge }, shellInfo, {
      commands: generated,
      listen,
    }),
  );
}
