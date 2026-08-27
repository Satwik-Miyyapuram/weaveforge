import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridge,
  DesktopCommitResult,
  DesktopLocalApi,
  DesktopOverleafSource,
  DesktopPreferenceValue,
  DesktopUpdate,
  DesktopVaultEntry,
  DesktopVaultRoot,
  DesktopZoteroReply,
} from "@/lib/desktop/desktop-bridge";
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

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
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
  readPreference: (name) => call<DesktopPreferenceValue>(CHANNELS.preferenceRead, name),
  writePreference: async (name, value) => {
    await call<null>(CHANNELS.preferenceWrite, name, value);
  },
  queryLocalDb: (sql, params) => call<unknown[]>(CHANNELS.dbQuery, sql, params),
  chooseVaultRoot: () => call<DesktopVaultRoot | null>(CHANNELS.vaultChoose),
  vaultRoot: () => call<DesktopVaultRoot | null>(CHANNELS.vaultRoot),
  forgetVaultRoot: async () => {
    await call<null>(CHANNELS.vaultForget);
  },
  readVaultFile: (path) => call<string | null>(CHANNELS.vaultRead, path),
  writeVaultFile: async (path, contents) => {
    await call<null>(CHANNELS.vaultWrite, path, contents);
  },
  listVaultFiles: (path) => call<DesktopVaultEntry[]>(CHANNELS.vaultList, path ?? ""),
  statVaultFile: (path) => call<DesktopVaultEntry | null>(CHANNELS.vaultStat, path),
  removeVaultFile: async (path) => {
    await call<null>(CHANNELS.vaultRemove, path);
  },
  commitVault: () => call<DesktopCommitResult>(CHANNELS.vaultCommit),
  localApiState: () => call<DesktopLocalApi>(CHANNELS.localApiState),
  zoteroLocal: (url) => call<DesktopZoteroReply>(CHANNELS.zoteroLocal, url),
  readOverleafProject: (projectId, entryFile) =>
    call<DesktopOverleafSource>(CHANNELS.overleafRead, projectId, entryFile),
  setLocalApi: (enabled) => call<DesktopLocalApi>(CHANNELS.localApiSet, enabled),
  readSecret: (name) => call<string | null>(CHANNELS.secretRead, name),
  writeSecret: async (name, value) => {
    await call<null>(CHANNELS.secretWrite, name, value);
  },
  clearSecret: async (name) => {
    await call<null>(CHANNELS.secretClear, name);
  },
  onVaultChange: (cb) => {
    // Wrapped for the same reason `onSignIn` is: the renderer must not be
    // handed Electron's event object, and with it a way back into this process.
    const listener = (_event: unknown, paths: string[]) => cb(paths);
    ipcRenderer.on(CHANNELS.vaultChanged, listener);
    return () => ipcRenderer.off(CHANNELS.vaultChanged, listener);
  },
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
