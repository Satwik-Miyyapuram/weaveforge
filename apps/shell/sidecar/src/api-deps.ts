/**
 * The deps the local API gets when the Tauri shell runs it, built from the wire peer.
 *
 * `registerMainLocalApi` was written against Electron; each helper here answers one of
 * its deps by asking the shell (or by emitting to it) instead of calling Electron.
 */

import { errorMessage } from "@weaveforge/core";
import { CHANNELS, type IpcResult } from "../../../desktop/src/channels";
import type { GuardedEvent, IpcSurface } from "../../../desktop/src/ipc-guard";
import type { LocalDbHost } from "../../../desktop/src/local-db-host";
import type { MainLocalApiDeps, RankWindow } from "../../../desktop/src/main-local-api";
import type { McpPaths } from "../../../desktop/src/mcp-connect";
import type { PreferenceStore, PreferenceValue } from "../../../desktop/src/preference-store";
import type { SecretStore } from "../../../desktop/src/secret-store";
import { newVaultSession, type VaultSession } from "../../../desktop/src/vault-handlers";
import { NodeWorkspaceFs } from "../../../desktop/src/vault-folder";
import type { Peer } from "./wire";

export type Handler = (params: unknown) => Promise<unknown>;

/** What the sidecar has for the local API. */
export interface SidecarApiOptions {
  peer: Pick<Peer, "ask" | "emit">;
  localDb: LocalDbHost;
  artifactRoot: string;
  mcpPaths: McpPaths;
  /** The bundled node that will run the MCP bridge. */
  execPath: string;
  version: string;
}

/** Electron's event is never read by the local API; the shell already checked the origin. */
const SHELL_EVENT = {} as unknown as GuardedEvent;

/** `ipc:<channel>` handlers for the shell to call, as `ipcMain` would have answered. */
export function wireIpc(handlers: Record<string, Handler>): IpcSurface {
  const register = (
    channel: string,
    listener: (event: GuardedEvent, ...args: unknown[]) => unknown,
    replies: boolean,
  ): void => {
    const key = "ipc:" + channel;
    if (Object.hasOwn(handlers, key)) throw new Error(`ipc:${channel} registered twice`);
    handlers[key] = async (params) => {
      if (!Array.isArray(params)) throw new Error(`ipc:${channel} needs an argument list`);
      const result = await listener(SHELL_EVENT, ...params);
      return replies ? result : null;
    };
  };
  return {
    handle: (channel, listener) => register(channel, listener, true),
    on: (channel, listener) => register(channel, listener, false),
  };
}

/** Asks the shell for a value and checks its type; failures come back as a message. */
async function askRead<T>(
  peer: Pick<Peer, "ask">,
  method: string,
  name: unknown,
  accept: (value: unknown) => value is T,
): Promise<IpcResult<T>> {
  try {
    const value = await peer.ask(method, { name });
    if (!accept(value)) return { ok: false, message: `${method}: bad reply` };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/** Asks the shell for a write or a clear; nothing comes back but success or the reason. */
async function askWrite(peer: Pick<Peer, "ask">, method: string, params: unknown): Promise<IpcResult<null>> {
  try {
    await peer.ask(method, params);
    return { ok: true, value: null };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

function isPreferenceValue(value: unknown): value is PreferenceValue {
  return value === null || typeof value === "string" || typeof value === "boolean";
}

function isSecretValue(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** The shell's preferences, read and written through `pref.*` asks. */
export function askPreferences(peer: Pick<Peer, "ask">): Pick<PreferenceStore, "read" | "write"> {
  return {
    read: (name) => askRead(peer, "pref.read", name, isPreferenceValue),
    write: (name, value) => askWrite(peer, "pref.write", { name, value }),
  };
}

/** The shell's keychain, through `secret.*` asks. */
export function askSecrets(peer: Pick<Peer, "ask">): Pick<SecretStore, "read" | "write" | "clear"> {
  return {
    read: (name) => askRead(peer, "secret.read", name, isSecretValue),
    write: (name, value) => askWrite(peer, "secret.write", { name, value }),
    clear: (name) => askWrite(peer, "secret.clear", { name }),
  };
}

/** The OS handlers, asked of the shell; the page never chooses the URL or path here. */
export function askOpen(peer: Pick<Peer, "ask">): MainLocalApiDeps["open"] {
  return {
    url: async (url) => {
      await peer.ask("open.url", { url });
    },
    path: async (file) => {
      try {
        await peer.ask("open.path", { path: file });
        return "";
      } catch (e) {
        return errorMessage(e);
      }
    },
  };
}

/** The event name the shell forwards to the window (its `HOST_EVENTS` allowlist). */
export const RANK_EVENT = "semanticRank";

/** A window whose only job is to send the semantic rank request to the shell as an event. */
export function wireWindow(peer: Pick<Peer, "emit">): RankWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel, ...args) {
        if (channel === CHANNELS.semanticRank) peer.emit(RANK_EVENT, args);
      },
    },
  };
}

/** `vault.root` handler: adopts the folder the shell chose, or forgets it on null. */
export function vaultRootHandler(session: VaultSession): Handler {
  return async (params) => {
    const { path: root, state } = (params ?? {}) as { path?: unknown; state?: unknown };
    if (root === null) {
      session.root = null;
      session.fs = null;
      return null;
    }
    // Refused without a state: the shell sends one, and a folder with no state is not adopted.
    if (typeof root !== "string" || (state !== "empty" && state !== "existing")) {
      throw new Error("vault.root needs { path }");
    }
    session.root = { path: root, state };
    session.fs = new NodeWorkspaceFs(root);
    return null;
  };
}

/** The deps for `registerMainLocalApi`, and the calls the shell makes into them. */
export function sidecarApiDeps(options: SidecarApiOptions): { deps: MainLocalApiDeps; handlers: Record<string, Handler> } {
  const handlers: Record<string, Handler> = {};
  const vault = newVaultSession();
  handlers["vault.root"] = vaultRootHandler(vault);
  const window = wireWindow(options.peer);
  const prefs = askPreferences(options.peer);
  const secrets = askSecrets(options.peer);
  const deps: MainLocalApiDeps = {
    ipc: wireIpc(handlers),
    vault,
    localDb: options.localDb,
    mainWindow: () => window,
    preferenceStore: () => prefs,
    secretStore: () => secrets,
    artifactRoot: options.artifactRoot,
    mcpPaths: options.mcpPaths,
    execPath: options.execPath,
    electron: false,
    version: options.version,
    open: askOpen(options.peer),
  };
  return { deps, handlers };
}
