/**
 * The local HTTP surface, off until somebody switches it on.
 *
 * Extracted from `main.ts` so the shell's own wiring — the window, the menu,
 * the updates — stays separate from the door this opens onto the vault.
 * Up to MAX_LOCAL_API_TOKENS tokens, stored as sha256 hashes with permissions and an
 * optional expiry; each is shown once at creation and revocable on its own.
 */

import path from "node:path";
import type { App, BrowserWindow, Shell } from "electron";

import type { PreferenceStore } from "./preference-store";
import type { SecretStore } from "./secret-store";
import { CHANNELS } from "./channels";
import { LOCAL_API_PERMISSIONS } from "./local-api";
import { listedTools } from "./local-mcp";
import {
  MCP_CLIENT_PERMISSIONS,
  MCP_CLIENT_TOKEN_NAME,
  MCP_BRIDGE_FILE,
  MCP_OPEN_CLIENTS,
  cursorInstallLink,
  mcpLaunch,
  vscodeInstallLink,
  writeMcpb,
  type McpOpenClient,
  readMcpConnection,
  removeMcpConnection,
  writeMcpConnection,
  mcpPaths,
  type McpPaths,
} from "./mcp-connect";
import { localArtifactWriter } from "./local-artifacts";
import type { IpcSurface } from "./ipc-guard";
import {
  LOCAL_API_HOST,
  LOCAL_API_PORT,
  MAX_LOCAL_API_TOKENS,
  hashLocalApiToken,
  makeLocalApiToken,
  parseLocalApiTokens,
  type LocalApiTokenRecord,
  startLocalApi,
  type LocalApi,
} from "./local-api-server";
import type { LocalDbHost } from "./local-db-host";
import type { VaultSession } from "./vault-handlers";

/** The Connect deps, read from Electron; the bridge ships beside main.js. */
export function shellMcpDeps(app: App, shell: Shell, homeVariant: string | undefined, appDir: string) {
  return {
    mcpPaths: mcpPaths(app.getPath("home"), homeVariant, path.join(appDir, MCP_BRIDGE_FILE)),
    execPath: process.execPath,
    version: app.getVersion(),
    open: { url: (url: string) => shell.openExternal(url), path: (file: string) => shell.openPath(file) },
  };
}

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
  /** Where Connect writes the token file and the bridge. */
  mcpPaths: McpPaths;
  /** This app's binary, which runs the bridge as Node. */
  execPath: string;
  /** Stamped into the .mcpb manifest. */
  version: string;
  /** The OS handlers for a client's install link or file; never fed a URL the page chose. */
  open: { url(url: string): Promise<void>; path(file: string): Promise<string> };
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
  // Kept so the panel can say why on any later read, not only the click that failed.
  let startError: string | undefined;
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
    remember(tokens);
    return { ok: true };
  }

  /** Swap in the live grants, keeping each one's in-memory last use. */
  function remember(tokens: LocalApiTokenRecord[]): void {
    const used = new Map(cachedGrants.map((g) => [g.id, g.usedAt]));
    cachedGrants = tokens.map((t) => ({ ...t, usedAt: used.get(t.id) }));
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
        { apiUrl: LOCAL_API_URL, tokenFile: deps.mcpPaths.file },
      );
      return (startError = undefined);
    } catch (error) {
      // The usual reason is another program on the port — Obsidian's own REST
      // plugin, most likely. Reported rather than retried: two things answering
      // on one port is not something to resolve behind the user's back.
      if ((error as NodeJS.ErrnoException)?.code === "EADDRINUSE")
        return (startError = `Another program is using port ${LOCAL_API_PORT}, so AI clients cannot reach WeaveForge. Close it, then tick Serve MCP again.`);
      return (startError = error instanceof Error ? error.message : "The port is not available.");
    }
  }

  async function resume(): Promise<void> {
    const enabled = await preferenceStore().read("local-api");
    if (!enabled.ok || enabled.value !== true) return;
    remember(await readTokens());
    if (!cachedGrants.length) return;
    await startIfEnabled();
  }

  /** The saved connection, when its token is still live. */
  async function savedMcp(tokens: LocalApiTokenRecord[]) {
    const saved = await readMcpConnection(deps.mcpPaths.file);
    const live = saved && tokens.some((t) => t.id === saved.tokenId && t.hash === hashLocalApiToken(saved.token));
    return live ? saved : null;
  }

  async function snapshot(extra?: { issued?: { id: string; token: string } }) {
    const enabled = await preferenceStore().read("local-api");
    const tokens = await readTokens();
    const used = new Map(cachedGrants.map((g) => [g.id, g.usedAt]));
    const saved = await savedMcp(tokens);
    return {
      enabled: localApi !== null && enabled.ok && enabled.value === true,
      url: LOCAL_API_URL,
      tokens: tokens.map(({ hash: _hash, usedAt: _usedAt, ...shown }) => {
        const at = used.get(shown.id);
        return at ? { ...shown, lastUsedAt: new Date(at).toISOString() } : shown;
      }),
      mcp: {
        connected: saved !== null,
        ...(saved && { tokenId: saved.tokenId }),
        url: `${LOCAL_API_URL}/mcp`,
        launch: mcpLaunch(deps.mcpPaths, deps.execPath),
      },
      ...(localApi === null && startError && { reason: startError }),
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
      startError = undefined;
      return { ok: true, value: await snapshot() };
    }
    remember(await readTokens());
    await preferenceStore().write("local-api", true);
    await startIfEnabled();
    return { ok: true, value: await snapshot() };
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
    const tokens = await readTokens();
    const saved = await savedMcp(tokens);
    const kept = await writeTokens(tokens.filter((t) => t.id !== id));
    if (!kept.ok) return kept;
    // A revoked token in the file would only make clients fail with a 401.
    if (saved?.tokenId === id) await removeMcpConnection(deps.mcpPaths.file);
    return { ok: true, value: await snapshot() };
  });

  ipc.handle(CHANNELS.mcpConnect, async () => {
    const tokens = await readTokens();
    let connection = await savedMcp(tokens);
    if (!connection) {
      if (tokens.length >= MAX_LOCAL_API_TOKENS)
        return { ok: false, message: `At most ${MAX_LOCAL_API_TOKENS} tokens. Revoke one in Access tokens first.` };
      const { record, token } = makeLocalApiToken(MCP_CLIENT_TOKEN_NAME, MCP_CLIENT_PERMISSIONS, null);
      const kept = await writeTokens([...tokens, record]);
      if (!kept.ok) return kept;
      connection = { url: "", apiUrl: "", token, tokenId: record.id };
    }
    try {
      await writeMcpConnection(
        deps.mcpPaths,
        { ...connection, url: `${LOCAL_API_URL}/mcp`, apiUrl: LOCAL_API_URL },
        listedTools(true),
      );
    } catch (error) {
      return { ok: false, message: `Could not write ${deps.mcpPaths.file}: ${error instanceof Error ? error.message : error}` };
    }
    remember(await readTokens());
    await preferenceStore().write("local-api", true);
    await startIfEnabled();
    return { ok: true, value: await snapshot() };
  });

  ipc.handle(CHANNELS.mcpDisconnect, async () => {
    const tokens = await readTokens();
    const saved = await readMcpConnection(deps.mcpPaths.file);
    if (saved) {
      const kept = await writeTokens(tokens.filter((t) => t.id !== saved.tokenId));
      if (!kept.ok) return kept;
    }
    await removeMcpConnection(deps.mcpPaths.file);
    return { ok: true, value: await snapshot() };
  });

  ipc.handle(CHANNELS.mcpOpenClient, async (_event, client: unknown) => {
    if (!MCP_OPEN_CLIENTS.includes(client as McpOpenClient)) return { ok: false, message: "Unknown client." };
    if (!(await savedMcp(await readTokens()))) return { ok: false, message: "Connect first." };
    const launch = mcpLaunch(deps.mcpPaths, deps.execPath);
    if (client === "cursor") await deps.open.url(cursorInstallLink(launch));
    else if (client === "vscode") await deps.open.url(vscodeInstallLink(launch));
    else {
      const file = await writeMcpb(deps.mcpPaths, listedTools(true), deps.version, launch);
      const failed = await deps.open.path(file);
      if (failed) return { ok: false, message: `Claude Desktop did not open ${file}: ${failed}` };
    }
    return { ok: true, value: undefined };
  });

  async function close(): Promise<void> {
    await localApi?.close();
    localApi = null;
  }

  return { startIfEnabled, resume, close };
}
