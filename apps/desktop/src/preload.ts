import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopUpdate } from "@/lib/desktop/desktop-bridge";
import { CHANNELS, type ImagePayload, type IpcResult, type TitlePayload } from "./channels";

/**
 * What the page is allowed to ask the machine for.
 *
 * Typed as `DesktopBridge` — the web app's own declaration, imported from
 * `apps/web/src/lib/desktop-bridge.ts` — so the contract has one definition and
 * the compiler checks this against it rather than against a comment. Add a
 * method there and this file stops compiling until it is implemented, which is
 * the point.
 *
 * Nothing else is exposed: no `ipcRenderer`, no `require`, no `process`. A page
 * that finds a way to run somebody else's script finds these three functions
 * and nothing more — and the listener among them is wrapped, so not even the
 * Electron event object crosses.
 */

/** Replaced at build time from the package version; see `scripts/build.mjs`. */
declare const __APP_VERSION__: string;

async function call<T>(channel: string, url: string): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, url)) as IpcResult<T>;
  // The reason travels as data and becomes an error here, because an error
  // thrown in the main process arrives with Electron's own prefix on its
  // message — and that message is shown to a person.
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

const bridge: DesktopBridge = {
  version: __APP_VERSION__,
  platform: process.platform as DesktopBridge["platform"],
  fetchTitle: (url) => call<TitlePayload>(CHANNELS.fetchTitle, url),
  fetchImage: (url) => call<ImagePayload>(CHANNELS.fetchImage, url),
  checkUpdate: () => ipcRenderer.invoke(CHANNELS.checkUpdate) as Promise<DesktopUpdate | null>,
  onSignIn: (cb) => {
    // The listener is wrapped rather than passed through, so the renderer never
    // receives Electron's `IpcRendererEvent` — which carries `sender`, and with
    // it a way back into this process that the contract does not offer.
    const listener = (_event: unknown, query: string) => cb(query);
    ipcRenderer.on(CHANNELS.signIn, listener);
    return () => ipcRenderer.off(CHANNELS.signIn, listener);
  },
};

contextBridge.exposeInMainWorld("weaveforge", bridge);
