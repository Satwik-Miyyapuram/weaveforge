/**
 * The local HTTP surface, off until somebody switches it on.
 *
 * Extracted from `main.ts` so the shell's own wiring — the window, the menu,
 * the updates — stays separate from the door this opens onto the vault.
 * Up to MAX_LOCAL_API_TOKENS tokens, stored as sha256 hashes with permissions and an
 * optional expiry; each is shown once at creation and revocable on its own.
 */

import type { BrowserWindow } from "electron";

import type { PreferenceStore } from "./preference-store";
import type { SecretStore } from "./secret-store";
import { CHANNELS } from "./channels";
import { LOCAL_API_PERMISSIONS } from "./local-api";
import { localArtifactWriter } from "./local-artifacts";
import type { IpcSurface } from "./ipc-guard";
import {
  LOCAL_API_HOST,
  LOCAL_API_PORT,
  MAX_LOCAL_API_TOKENS,
  makeLocalApiToken,
  parseLocalApiTokens,
  type LocalApiTokenRecord,
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
  /** Folder SDK artifact uploads are written to. */
  artifactRoot: string;
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
  let cachedGrants: LocalApiTokenRecord[] = [];

  const LOCAL_API_URL = `http://${LOCAL_API_HOST}:${LOCAL_API_PORT}`;

  async function readTokens(): Promise<LocalApiTokenRecord[]> {
    const stored = await secretStore().read("local-api-token");
    if (!stored.ok || !stored.value) return [];
    const { records, legacy } = parseLocalApiTokens(stored.value);
    // Drop the old plaintext token from the store; only its hash stays.
    if (legacy) await writeTokens(records);
    return records;
  }

  async function writeTokens(
    tokens: LocalApiTokenRecord[],
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const kept = tokens.length
      ? await secretStore().write("local-api-token", JSON.stringify(tokens))
      : await secretStore().clear("local-api-token");
    if (!kept.ok) return { ok: false, message: kept.message };
    cachedGrants = tokens;
    return { ok: true };
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
        () => cachedGrants,
        (sql, params) => localDb.query(sql, params),
        rankSemantically,
        localArtifactWriter(deps.artifactRoot),
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
    cachedGrants = await readTokens();
    if (!cachedGrants.length) return;
    await startIfEnabled();
  }

  async function snapshot(extra?: { reason?: string; issued?: { id: string; token: string } }) {
    const enabled = await preferenceStore().read("local-api");
    return {
      enabled: localApi !== null && enabled.ok && enabled.value === true,
      url: LOCAL_API_URL,
      tokens: (await readTokens()).map(({ hash: _hash, ...shown }) => shown),
      ...extra,
    };
  }

  ipc.handle(CHANNELS.localApiState, async () => ({ ok: true, value: await snapshot() }));

  ipc.handle(CHANNELS.localApiSet, async (_event, enabled: unknown) => {
    if (enabled !== true) {
      // Tokens survive switching off, so scripts work again once it is back on.
      await preferenceStore().write("local-api", false);
      await localApi?.close();
      localApi = null;
      return { ok: true, value: await snapshot() };
    }
    cachedGrants = await readTokens();
    await preferenceStore().write("local-api", true);
    const reason = await startIfEnabled();
    return { ok: true, value: await snapshot(reason ? { reason } : undefined) };
  });

  ipc.handle(CHANNELS.localApiTokenCreate, async (_event, request: unknown) => {
    const r = (request ?? {}) as { name?: unknown; permissions?: unknown; expiresAt?: unknown };
    const tokens = await readTokens();
    if (tokens.length >= MAX_LOCAL_API_TOKENS)
      return { ok: false, message: `At most ${MAX_LOCAL_API_TOKENS} tokens. Revoke one first.` };
    const name =
      typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : `Token ${tokens.length + 1}`;
    const permissions = LOCAL_API_PERMISSIONS.filter(
      (p) => Array.isArray(r.permissions) && r.permissions.includes(p),
    );
    if (!permissions.length) return { ok: false, message: "Pick at least one permission." };
    let expiresAt: string | null = null;
    if (r.expiresAt !== null) {
      const at = typeof r.expiresAt === "string" ? Date.parse(r.expiresAt) : NaN;
      if (!(at > Date.now())) return { ok: false, message: "The expiry must be in the future." };
      expiresAt = new Date(at).toISOString();
    }
    const { record, token } = makeLocalApiToken(name, permissions, expiresAt);
    const kept = await writeTokens([...tokens, record]);
    if (!kept.ok) return kept;
    // The only time the token itself leaves the shell.
    return { ok: true, value: await snapshot({ issued: { id: record.id, token } }) };
  });

  ipc.handle(CHANNELS.localApiTokenRevoke, async (_event, id: unknown) => {
    const kept = await writeTokens((await readTokens()).filter((t) => t.id !== id));
    if (!kept.ok) return kept;
    return { ok: true, value: await snapshot() };
  });

  async function close(): Promise<void> {
    await localApi?.close();
    localApi = null;
  }

  return { startIfEnabled, resume, close };
}
