import type {
  DesktopAppLog,
  DesktopBridge,
  DesktopCommit,
  DesktopCommitResult,
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

/** The generated commands this part of the shim calls (names as tauri-specta camelCases them). */
export interface DesktopCommands {
  vaultRoot(): Promise<Result<DesktopVaultRoot | null>>;
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
}

/** The desktop members this shim provides, as `window.weaveforge` expects them. */
export type DesktopShim = Pick<
  DesktopBridge,
  | "vaultRoot"
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
export function desktopShim(cmds: DesktopCommands): DesktopShim {
  return {
    vaultRoot: async () => unwrap(await cmds.vaultRoot()),
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
