import type {
  DesktopAppLog,
  DesktopBridge,
  DesktopCommit,
  DesktopCommitResult,
  DesktopInkHaptics,
  DesktopInkResult,
  DesktopLocalApi,
  DesktopOverleafSource,
  DesktopPreferenceName,
  DesktopPreferenceValue,
  DesktopSecretName,
  DesktopTexCompileResult,
  DesktopTexTool,
  DesktopUpdate,
  DesktopVaultEntry,
  DesktopVaultRoot,
  DesktopVaultSync,
  DesktopZoteroReply,
} from "@/lib/desktop/desktop-bridge";
import { fromBase64, toBase64, unwrap } from "./bridge";
import type { commands } from "./bindings";

/** Compiles only while the generated commands still fit what this shim expects. */
export type GeneratedCommandsFit = typeof commands extends DesktopCommands
  ? true
  : never;
const generatedCommandsFit: GeneratedCommandsFit = true;
void generatedCommandsFit;

type Result<T> =
  { status: "ok"; data: T } | { status: "error"; error: { message: string } };

/** A TeX compile result as it crosses the bridge: the pdf is base64. */
type WireTexResult = Omit<DesktopTexCompileResult, "pdf"> & {
  pdf: string | null;
};

/** A recognise answer as it crosses the bridge: Rust floats arrive as null when not finite. */
type WireInkResult = Omit<DesktopInkResult, "lines" | "ms"> & {
  ms: number | null;
  lines: (Omit<DesktopInkResult["lines"][number], "confidence"> & {
    confidence: number | null;
  })[];
};

/** The page's recognise answer; a missing confidence or time reads as 0. */
function toInkResult(wire: WireInkResult): DesktopInkResult {
  return {
    ...wire,
    ms: wire.ms ?? 0,
    lines: wire.lines.map((line) => ({
      ...line,
      confidence: line.confidence ?? 0,
    })),
  };
}

/** The generated commands this part of the shim calls (names as tauri-specta camelCases them). */
export interface DesktopCommands {
  vaultRoot(): Promise<Result<DesktopVaultRoot | null>>;
  vaultChoose(): Promise<Result<DesktopVaultRoot | null>>;
  vaultRead(path: string): Promise<Result<string | null>>;
  vaultWrite(path: string, contents: string): Promise<Result<null>>;
  vaultReadBytes(path: string): Promise<Result<string | null>>; // base64
  vaultWriteBytes(path: string, bytes: string): Promise<Result<null>>; // base64
  vaultList(path: string | null): Promise<Result<DesktopVaultEntry[]>>;
  vaultStat(path: string): Promise<Result<DesktopVaultEntry | null>>;
  vaultRemove(path: string): Promise<Result<null>>;
  vaultCommit(): Promise<Result<DesktopCommitResult>>;
  vaultLog(limit: number | null): Promise<Result<DesktopCommit[]>>;
  vaultSync(action: string): Promise<Result<DesktopVaultSync>>;
  fetchTitle(url: string): Promise<Result<{ title: string; url: string }>>;
  fetchImage(
    url: string,
  ): Promise<Result<{ bytes: string; contentType: string; url: string }>>;
  texProbe(): Promise<Result<DesktopTexTool | null>>;
  texCompile(
    files: { path: string; content: string }[],
    entryFile: string,
  ): Promise<Result<WireTexResult>>;
  zoteroLocal(url: string): Promise<Result<DesktopZoteroReply>>;
  updateCheck(): Promise<Result<DesktopUpdate | null>>;
  appLogReport(report: {
    level: string;
    source: string | null;
    message: string;
    detail: string | null;
  }): Promise<Result<null>>;
  appLogRead(): Promise<Result<DesktopAppLog>>;
  preferenceWrite(
    name: DesktopPreferenceName,
    value: DesktopPreferenceValue,
  ): Promise<Result<null>>;
  secretRead(name: DesktopSecretName): Promise<Result<string | null>>;
  secretWrite(name: DesktopSecretName, value: string): Promise<Result<null>>;
  secretClear(name: DesktopSecretName): Promise<Result<null>>;
  overleafRead(
    projectId: string,
    entryFile: string,
  ): Promise<Result<DesktopOverleafSource>>;
  overleafSync(
    action: string,
    projectId: string | null,
    folder: string | null,
  ): Promise<
    Result<{ links: { projectId: string; folder: string }[]; hasToken: boolean }>
  >;
  mattermostSignIn(serverUrl: string): Promise<Result<string | null>>;
  mattermostPost(post: {
    serverUrl: string;
    token: string;
    channelId: string;
    message: string;
  }): Promise<Result<{ status: number; body: string }>>;
  inkAvailable(): Promise<Result<boolean>>;
  inkRecognise(request: {
    lines: { strokes: number[][] }[];
    vocabulary: string[] | null;
    lang: string | null;
  }): Promise<Result<WireInkResult>>;
  inkHapticsAvailable(): Promise<Result<boolean>>;
  inkHaptics(message: DesktopInkHaptics): Promise<Result<null>>;
  localApiCall(channel: string, args: unknown[]): Promise<Result<unknown>>;
}

/** Subscribes to a shell event; resolves to the way to stop listening. */
export interface DesktopEvents {
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}

/** The event the shell emits with folder-relative paths changed by other programs. */
export const VAULT_CHANGED_EVENT = "vault-changed";

/** The event the sidecar emits to ask for a semantic ranking: [id, query, candidates]. */
export const SEMANTIC_RANK_EVENT = "semanticRank";

/** The Electron-era handler channels `local_api_call` forwards to (literals, as in apps/desktop/src/channels.ts). */
export const LOCAL_API = {
  state: "weaveforge:local-api-state",
  set: "weaveforge:local-api-set",
  tokenCreate: "weaveforge:local-api-token-create",
  tokenRevoke: "weaveforge:local-api-token-revoke",
  mcpConnect: "weaveforge:mcp-connect",
  mcpDisconnect: "weaveforge:mcp-disconnect",
  mcpOpenClient: "weaveforge:mcp-open-client",
  semanticRanked: "weaveforge:semantic-ranked",
} as const;

/** Whether a `semanticRank` payload has the id, query and string candidates it should. */
function isSemanticRankPayload(
  payload: unknown,
): payload is [number, string, string[]] {
  return (
    Array.isArray(payload) &&
    typeof payload[0] === "number" &&
    typeof payload[1] === "string" &&
    Array.isArray(payload[2]) &&
    payload[2].every((c) => typeof c === "string")
  );
}

/** The desktop members this shim provides, as `window.weaveforge` expects them. */
export type DesktopShim = Pick<
  DesktopBridge,
  | "onVaultChange"
  | "localApiState"
  | "setLocalApi"
  | "createLocalApiToken"
  | "revokeLocalApiToken"
  | "connectMcp"
  | "disconnectMcp"
  | "openMcpClient"
  | "onSemanticRank"
  | "inkAvailable"
  | "inkHapticsAvailable"
  | "inkRecognise"
  | "inkHaptics"
  | "mattermostSignIn"
  | "mattermostPost"
  | "readOverleafProject"
  | "overleafSync"
  | "vaultRoot"
  | "chooseVaultRoot"
  | "readVaultFile"
  | "writeVaultFile"
  | "readVaultBytes"
  | "writeVaultBytes"
  | "listVaultFiles"
  | "statVaultFile"
  | "removeVaultFile"
  | "commitVault"
  | "vaultLog"
  | "vaultSync"
  | "fetchTitle"
  | "fetchImage"
  | "probeTex"
  | "compileTex"
  | "zoteroLocal"
  | "checkUpdate"
  | "reportAppLog"
  | "readAppLog"
  | "writePreference"
  | "readSecret"
  | "writeSecret"
  | "clearSecret"
>;

/** Wraps the generated commands as the desktop members of `DesktopBridge`. */
export function desktopShim(
  cmds: DesktopCommands,
  events: DesktopEvents,
): DesktopShim {
  // Cast to the page's type, as preload's `call<T>` does.
  const localApi = async <T>(channel: string, args: unknown[]) =>
    unwrap(await cmds.localApiCall(channel, args)) as T;
  // Never rejects: a failed answer is logged, the sidecar's request stays unanswered.
  const answerRank = async (body: unknown[]) => {
    try {
      unwrap(await cmds.localApiCall(LOCAL_API.semanticRanked, body));
    } catch (error: unknown) {
      console.warn("Semantic ranking answer was not delivered:", error);
    }
  };
  return {
    localApiState: () => localApi<DesktopLocalApi>(LOCAL_API.state, []),
    setLocalApi: (enabled) =>
      localApi<DesktopLocalApi>(LOCAL_API.set, [enabled]),
    createLocalApiToken: (request) =>
      localApi<DesktopLocalApi>(LOCAL_API.tokenCreate, [request]),
    revokeLocalApiToken: (id) =>
      localApi<DesktopLocalApi>(LOCAL_API.tokenRevoke, [id]),
    connectMcp: () => localApi<DesktopLocalApi>(LOCAL_API.mcpConnect, []),
    disconnectMcp: () => localApi<DesktopLocalApi>(LOCAL_API.mcpDisconnect, []),
    openMcpClient: async (client) => {
      // Resolves to nothing, as in Electron; whatever the handler returned is dropped.
      await localApi<unknown>(LOCAL_API.mcpOpenClient, [client]);
    },
    // Same unlisten rule as `onVaultChange`: a stop before `listen` resolves still unlistens.
    onSemanticRank: (cb) => {
      let stopped = false;
      let unlisten: (() => void) | null = null;
      void events
        .listen(SEMANTIC_RANK_EVENT, (payload) => {
          if (stopped || !isSemanticRankPayload(payload)) return;
          const [id, query, candidates] = payload;
          // A throw or rejection still answers, with its reason, so the sidecar is never left waiting.
          void Promise.resolve()
            .then(() => cb(query, candidates))
            .then(
              (order) => answerRank([id, order]),
              (err: unknown) =>
                answerRank([id, null, err instanceof Error ? err.message : String(err)]),
            );
        })
        .then((stop) => {
          if (stopped) stop();
          else unlisten = stop;
        })
        .catch((error: unknown) => {
          console.warn("Semantic ranking will not run:", error);
        });
      return () => {
        if (stopped) return;
        stopped = true;
        unlisten?.();
        unlisten = null;
      };
    },
    // A stop before `listen` resolves must still unlisten, or the watch leaks.
    onVaultChange: (cb) => {
      let stopped = false;
      let unlisten: (() => void) | null = null;
      void events
        .listen(VAULT_CHANGED_EVENT, (payload) => {
          if (stopped || !Array.isArray(payload)) return;
          const paths = payload.filter((p): p is string => typeof p === "string");
          if (paths.length > 0) cb(paths);
        })
        .then((stop) => {
          if (stopped) stop();
          else unlisten = stop;
        })
        .catch((error: unknown) => {
          console.warn("Outside changes to the workspace folder will not show up live:", error);
        });
      return () => {
        if (stopped) return;
        stopped = true;
        unlisten?.();
        unlisten = null;
      };
    },
    inkAvailable: async () => {
      try {
        return unwrap(await cmds.inkAvailable());
      } catch {
        return false;
      }
    },
    inkHapticsAvailable: async () => {
      try {
        return unwrap(await cmds.inkHapticsAvailable());
      } catch {
        return false;
      }
    },
    inkRecognise: async (request) =>
      toInkResult(
        unwrap(
          await cmds.inkRecognise({
            lines: request.lines.map((l) => ({ strokes: l.strokes })),
            vocabulary: request.vocabulary ?? null,
            lang: request.lang ?? null,
          }),
        ),
      ),
    // Haptics are fire and forget, so a failed send is dropped like a failed log.
    inkHaptics: (message) => {
      void cmds
        .inkHaptics(message)
        .then((reply) => unwrap(reply))
        .catch(() => {});
    },
    mattermostSignIn: async (serverUrl) =>
      unwrap(await cmds.mattermostSignIn(serverUrl)),
    mattermostPost: async (req) =>
      unwrap(
        await cmds.mattermostPost({
          serverUrl: req.serverUrl,
          token: req.token,
          channelId: req.channelId,
          message: req.message,
        }),
      ),
    readOverleafProject: async (projectId, entryFile) =>
      unwrap(await cmds.overleafRead(projectId, entryFile)),
    overleafSync: async (request) => {
      const projectId = request.action === "list" ? null : request.projectId;
      const folder =
        request.action === "link" ? (request.folder ?? null) : null;
      return unwrap(await cmds.overleafSync(request.action, projectId, folder));
    },
    vaultRoot: async () => unwrap(await cmds.vaultRoot()),
    chooseVaultRoot: async () => unwrap(await cmds.vaultChoose()),
    readVaultFile: async (path) => unwrap(await cmds.vaultRead(path)),
    writeVaultFile: async (path, contents) => {
      unwrap(await cmds.vaultWrite(path, contents));
    },
    readVaultBytes: async (path) => {
      const data = unwrap(await cmds.vaultReadBytes(path));
      return data === null ? null : fromBase64(data);
    },
    writeVaultBytes: async (path, bytes) => {
      unwrap(await cmds.vaultWriteBytes(path, toBase64(bytes)));
    },
    listVaultFiles: async (path) => unwrap(await cmds.vaultList(path ?? null)),
    statVaultFile: async (path) => unwrap(await cmds.vaultStat(path)),
    removeVaultFile: async (path) => {
      unwrap(await cmds.vaultRemove(path));
    },
    commitVault: async () => unwrap(await cmds.vaultCommit()),
    vaultLog: async (limit) => unwrap(await cmds.vaultLog(limit)),
    vaultSync: async (action) => unwrap(await cmds.vaultSync(action)),
    fetchTitle: async (url) => unwrap(await cmds.fetchTitle(url)),
    fetchImage: async (url) => {
      const image = unwrap(await cmds.fetchImage(url));
      return {
        bytes: exactBytes(fromBase64(image.bytes)),
        contentType: image.contentType,
        url: image.url,
      };
    },
    probeTex: async () => unwrap(await cmds.texProbe()),
    compileTex: async (files, entryFile) => {
      const result = unwrap(
        await cmds.texCompile(
          files.map((f) => ({ path: f.path, content: f.content })),
          entryFile,
        ),
      );
      return {
        ...result,
        pdf: result.pdf === null ? null : exactBytes(fromBase64(result.pdf)),
      };
    },
    zoteroLocal: async (url) => unwrap(await cmds.zoteroLocal(url)),
    checkUpdate: async () => unwrap(await cmds.updateCheck()),
    // Logging must never throw into the page, so a failed report is dropped.
    reportAppLog: (entry) => {
      void cmds
        .appLogReport({
          level: entry.level,
          source: entry.source,
          message: entry.message,
          detail: entry.detail ?? null,
        })
        .catch(() => {});
    },
    readAppLog: async () => unwrap(await cmds.appLogRead()),
    writePreference: async (name, value) => {
      unwrap(await cmds.preferenceWrite(name, value));
    },
    readSecret: async (name) => unwrap(await cmds.secretRead(name)),
    writeSecret: async (name, value) => {
      unwrap(await cmds.secretWrite(name, value));
    },
    clearSecret: async (name) => {
      unwrap(await cmds.secretClear(name));
    },
  };
}

/** An ArrayBuffer holding exactly `body`'s bytes, not the whole buffer it views. */
function exactBytes(body: Uint8Array): ArrayBuffer {
  return body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer;
}
