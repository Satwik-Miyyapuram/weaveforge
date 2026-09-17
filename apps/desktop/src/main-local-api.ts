/**
 * The local HTTP surface, off until somebody switches it on.
 *
 * Extracted from `main.ts` so the shell's own wiring — the window, the menu,
 * the updates — stays separate from the door this opens onto the vault.
 * The token is read from the keychain per request rather than held here, so
 * revoking it takes effect immediately, and a token that was never generated
 * reads as an empty string — which `routeLocalRequest` refuses outright.
 */

import type { BrowserWindow } from "electron";

import type { PreferenceStore } from "./preference-store";
import type { SecretStore } from "./secret-store";
import { CHANNELS } from "./channels";
import type { IpcSurface } from "./ipc-guard";
import {
  LOCAL_API_HOST,
  LOCAL_API_PORT,
  newLocalApiToken,
  startLocalApi,
  type LocalApi,
} from "./local-api-server";
import type { LocalDbHost } from "./local-db-host";
import type { VaultSession } from "./vault-handlers";

/** What the local API needs from the shell. */
export interface MainLocalApiDeps {
  /** The guarded IPC, already pinned to the app's origin. */
  ipc: IpcSurface;
  /** The vault the door opens onto. */
  vault: VaultSession;
  /** The local database the queries run against. */
  localDb: LocalDbHost;
  /** The window that holds the semantic encoder, when one is up. */
  mainWindow: () => BrowserWindow | null;
  /** Where the shell's preferences live. */
  preferenceStore: () => PreferenceStore;
  /** Where the token lives. */
  secretStore: () => SecretStore;
}

export interface MainLocalApi {
  /** Whether the local HTTP surface is answering. */
  startIfEnabled(): Promise<string | undefined>;
  /** Called once per start and per token change. */
  resume(): Promise<void>;
  /** Close the door, on the way out of the app. */
  close(): Promise<void>;
}

export function registerMainLocalApi(
  deps: MainLocalApiDeps,
): MainLocalApi {
  const { ipc, vault, localDb, preferenceStore, secretStore } = deps;

  let localApi: LocalApi | null = null;
  /** Read once per start and per token change, because a socket cannot await. */
  let cachedToken = "";

  const LOCAL_API_URL = `http://${LOCAL_API_HOST}:${LOCAL_API_PORT}`;

  async function localApiToken(): Promise<string> {
    const stored = await secretStore().read("local-api-token");
    return stored.ok && stored.value ? stored.value : "";
  }

  /**
   * Ask the window to rank a word search by meaning.
   *
   * The encoder is in the renderer — it is a WebAssembly model in a worker, and
   * there is one of it, loaded when somebody turned semantic search on. So the
   * server asks, and takes silence for an answer: no window, no encoder, or a
   * window that takes too long all mean "keep the order you have", which is a
   * worse ranking and never a failed tool call.
   */
  const RANK_TIMEOUT_MS = 4_000;
  let nextRankId = 1;
  const pendingRanks = new Map<number, (order: string[] | null) => void>();

  ipc.on(CHANNELS.semanticRanked, (_event, id: unknown, order: unknown) => {
    if (typeof id !== "number") return;
    const waiting = pendingRanks.get(id);
    if (!waiting) return;
    pendingRanks.delete(id);
    waiting(
      Array.isArray(order)
        ? (order as string[]).filter((name) => typeof name === "string")
        : null,
    );
  });

  function rankSemantically(
    query: string,
    candidates: readonly string[],
  ): Promise<string[] | null> {
    const window = deps.mainWindow();
    if (!window || window.isDestroyed() || candidates.length < 2)
      return Promise.resolve(null);

    const id = nextRankId++;
    return new Promise<string[] | null>((resolve) => {
      const finish = (order: string[] | null) => {
        clearTimeout(timer);
        resolve(order);
      };
      const timer = setTimeout(() => {
        pendingRanks.delete(id);
        resolve(null);
      }, RANK_TIMEOUT_MS);
      pendingRanks.set(id, finish);
      window.webContents.send(CHANNELS.semanticRank, id, query, [...candidates]);
    });
  }

  async function startIfEnabled(): Promise<string | undefined> {
    if (localApi) return undefined;
    try {
      localApi = await startLocalApi(
        vault,
        () => cachedToken,
        (sql, params) => localDb.query(sql, params),
        rankSemantically,
      );
      return undefined;
    } catch (error) {
      // The usual reason is another program on the port — Obsidian's own REST
      // plugin, most likely. Reported rather than retried: two things answering
      // on one port is not something to resolve behind the user's back.
      return error instanceof Error
        ? error.message
        : "The port is not available.";
    }
  }

  async function resume(): Promise<void> {
    const enabled = await preferenceStore().read("local-api");
    if (!enabled.ok || enabled.value !== true) return;
    cachedToken = await localApiToken();
    if (!cachedToken) return;
    await startIfEnabled();
  }

  ipc.handle(CHANNELS.localApiState, async () => {
    const enabled = await preferenceStore().read("local-api");
    return {
      ok: true,
      value: {
        enabled: localApi !== null && enabled.ok && enabled.value === true,
        url: LOCAL_API_URL,
      },
    };
  });

  ipc.handle(CHANNELS.localApiSet, async (_event, enabled: unknown) => {
    if (enabled !== true) {
      await preferenceStore().write("local-api", false);
      await secretStore().clear("local-api-token");
      cachedToken = "";
      await localApi?.close();
      localApi = null;
      return { ok: true, value: { enabled: false, url: LOCAL_API_URL } };
    }

    // A new token every time it is switched on. Reusing the old one would mean
    // that switching the door off and on again leaves the same keys working.
    const token = newLocalApiToken();
    const kept = await secretStore().write("local-api-token", token);
    if (!kept.ok) return { ok: false, message: kept.message };
    cachedToken = token;
    await preferenceStore().write("local-api", true);
    const reason = await startIfEnabled();
    return {
      ok: true,
      value: {
        enabled: localApi !== null,
        url: LOCAL_API_URL,
        token,
        ...(reason ? { reason } : {}),
      },
    };
  });

  async function close(): Promise<void> {
    await localApi?.close();
    localApi = null;
  }

  return { startIfEnabled, resume, close };
}
