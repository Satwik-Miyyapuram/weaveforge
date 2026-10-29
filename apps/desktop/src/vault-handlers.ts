import type { WorkspaceCommit } from "@weaveforge/core";

import type { IpcResult, VaultEntryPayload, VaultRootPayload } from "./channels";
import { NodeWorkspaceFs, verifyRoot, workspaceRootFor } from "./vault-folder";
import { syncOverleaf, type OverleafSyncDeps, type OverleafSyncReply } from "./overleaf-sync";
import { commitVault, syncVault, vaultLog, type VaultSyncReply, type VaultSyncSettings } from "./vault-git";

/**
 * What the workspace-folder channels do, with no Electron in sight.
 *
 * Separated from `main.ts` for the same reason the fetch handlers are: the
 * part worth testing is the shaping — that an unchosen folder is a refusal
 * rather than a crash, that a path leaving the root never reaches disk, and
 * that a read of a missing file comes back as a message.
 *
 * The chosen root is held here rather than passed on every call. A renderer
 * that could name its own root on each request would be choosing folders
 * without a dialog, which is the one thing the dialog exists to prevent.
 */

const NO_ROOT = "No workspace folder is chosen yet.";
const BAD_ARGUMENT = "That is not a path this folder can hold.";

/**
 * How much of one file crosses this bridge, in bytes.
 *
 * A workspace note is prose and is a few kilobytes; the largest thing the
 * mirror writes is a document with a bibliography in it, and the largest that
 * has turned up in this repository's own fixtures is under a megabyte. Eight
 * is a ceiling, not a target: it is the point past which the file is not a
 * note this app wrote, and the cost of guessing wrong is one refusal with a
 * reason rather than a page that has to be read into a renderer's heap.
 *
 * Named and exported for the same reason `MAX_BODY` is in
 * `local-api-server.ts` -- the number belongs to one place, and the test that
 * asserts the refusal should not have to repeat it to mean anything.
 */
export const MAX_VAULT_BYTES = 8 * 1024 * 1024;
/**
 * The cap for bytes, which are PDFs: the same 80 MiB the reader's proxy will
 * hand over, so nothing the proxy accepts is then refused a place on disk.
 */
export const MAX_VAULT_BLOB_BYTES = 80 * 1024 * 1024;

/** Said when a file is too big to cross, on both sides of the bridge; names the cap that applied. */
function tooLarge(cap: number): string {
  return `That file is too large to open here (over ${cap / (1024 * 1024)} MB).`;
}

export interface VaultSession {
  root: VaultRootPayload | null;
  fs: NodeWorkspaceFs | null;
}

export function newVaultSession(): VaultSession {
  return { root: null, fs: null };
}

/** Told when the chosen folder changes, so it can outlive the process. */
export type RememberRoot = (root: string | null) => void;

/**
 * Adopt a directory the user *chose*.
 *
 * A folder that is already theirs is not refused: the workspace goes in
 * `WeaveForge/` inside it and that is what is adopted (see `workspaceRootFor`),
 * so what the renderer is told to show is where the files really are.
 */
export async function chooseRoot(
  session: VaultSession,
  chosen: string | null,
  remember?: RememberRoot,
): Promise<IpcResult<VaultRootPayload | null>> {
  if (chosen === null) return { ok: true, value: session.root };
  const choice = await workspaceRootFor(chosen);
  if (!choice.ok) return { ok: false, message: choice.reason };
  session.root = { path: choice.root, state: choice.state };
  session.fs = new NodeWorkspaceFs(choice.root);
  remember?.(choice.root);
  return { ok: true, value: session.root };
}

/** Adopt a directory that was remembered. Refuses anything `verifyRoot` refuses. */
export async function adoptRoot(
  session: VaultSession,
  chosen: string | null,
  remember?: RememberRoot,
): Promise<IpcResult<VaultRootPayload | null>> {
  // A cancelled dialog is not a failure: it is the user declining, and the
  // renderer should see the folder unchanged rather than an error.
  if (chosen === null) return { ok: true, value: session.root };

  const verdict = await verifyRoot(chosen);
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  session.root = { path: chosen, state: verdict.state };
  session.fs = new NodeWorkspaceFs(chosen);
  remember?.(chosen);
  return { ok: true, value: session.root };
}

/**
 * Take up a folder remembered from a previous run.
 *
 * Re-verified rather than trusted: between two launches the folder can have
 * been deleted, moved, or replaced by an unrelated directory at the same path.
 * A folder that no longer passes is forgotten rather than written to, and the
 * user is back to having chosen nothing — which is recoverable, where writing
 * a workspace into a stranger's directory is not.
 */
export async function restoreRoot(
  session: VaultSession,
  remembered: unknown,
  remember?: RememberRoot,
): Promise<VaultRootPayload | null> {
  if (typeof remembered !== "string" || !remembered) return null;
  const adopted = await adoptRoot(session, remembered, remember);
  if (adopted.ok) return adopted.value;
  remember?.(null);
  return null;
}

export function currentRoot(session: VaultSession): IpcResult<VaultRootPayload | null> {
  return { ok: true, value: session.root };
}

export async function readVaultFile(
  session: VaultSession,
  relative: unknown,
): Promise<IpcResult<string | null>> {
  return readCapped(session, relative, MAX_VAULT_BYTES, (fs, at) => fs.readText(at));
}

export async function readVaultBytes(
  session: VaultSession,
  relative: unknown,
): Promise<IpcResult<Uint8Array | null>> {
  return readCapped(session, relative, MAX_VAULT_BLOB_BYTES, (fs, at) => fs.readFile(at));
}

/**
 * One read for both channels, sized before it is read rather than after. A
 * read that lands first would already have put the whole file on this side's
 * heap to find out, which is the cost the cap exists to avoid -- and a folder
 * can be watched by something that writes a database file into it.
 */
async function readCapped<T>(
  session: VaultSession,
  relative: unknown,
  cap: number,
  read: (fs: NodeWorkspaceFs, at: string) => Promise<T>,
): Promise<IpcResult<T | null>> {
  if (!session.fs) return { ok: false, message: NO_ROOT };
  if (typeof relative !== "string") return { ok: false, message: BAD_ARGUMENT };
  try {
    const stat = await session.fs.stat(relative);
    if (stat && stat.size > cap) return { ok: false, message: tooLarge(cap) };
    return { ok: true, value: await read(session.fs, relative) };
  } catch (error) {
    // A missing file is a `null`, not a failure — callers ask about files that
    // may not exist yet. Anything else is a refusal with its reason.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
    return { ok: false, message: messageOf(error) };
  }
}

export async function writeVaultBytes(
  session: VaultSession,
  relative: unknown,
  bytes: unknown,
): Promise<IpcResult<null>> {
  if (!(bytes instanceof Uint8Array)) return refuseWrite(session);
  return writeCapped(session, relative, bytes, bytes.byteLength, MAX_VAULT_BLOB_BYTES);
}

export async function writeVaultFile(
  session: VaultSession,
  relative: unknown,
  contents: unknown,
): Promise<IpcResult<null>> {
  if (typeof contents !== "string") return refuseWrite(session);
  // Measured in bytes rather than characters, because bytes are what the disk
  // is asked for and what a cap is about: a page of prose can be a megabyte of
  // UTF-8.
  return writeCapped(session, relative, contents, Buffer.byteLength(contents, "utf8"), MAX_VAULT_BYTES);
}

/** A write whose contents are the wrong type: no root still reads as no root. */
function refuseWrite(session: VaultSession): IpcResult<null> {
  return { ok: false, message: session.fs ? BAD_ARGUMENT : NO_ROOT };
}

/** One write for both channels, refused before it lands when over its cap. */
async function writeCapped(
  session: VaultSession,
  relative: unknown,
  contents: string | Uint8Array,
  size: number,
  cap: number,
): Promise<IpcResult<null>> {
  if (!session.fs) return { ok: false, message: NO_ROOT };
  if (typeof relative !== "string") return { ok: false, message: BAD_ARGUMENT };
  if (size > cap) return { ok: false, message: tooLarge(cap) };
  try {
    await session.fs.writeFile(relative, contents);
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function listVaultFiles(
  session: VaultSession,
  dir: unknown,
): Promise<IpcResult<VaultEntryPayload[]>> {
  if (!session.fs) return { ok: false, message: NO_ROOT };
  if (dir !== undefined && typeof dir !== "string") return { ok: false, message: BAD_ARGUMENT };
  try {
    const entries = await session.fs.list(dir ?? "");
    return {
      ok: true,
      value: entries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      })),
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function statVaultFile(
  session: VaultSession,
  relative: unknown,
): Promise<IpcResult<VaultEntryPayload | null>> {
  if (!session.fs) return { ok: false, message: NO_ROOT };
  if (typeof relative !== "string") return { ok: false, message: BAD_ARGUMENT };
  try {
    const stat = await session.fs.stat(relative);
    if (!stat) return { ok: true, value: null };
    return {
      ok: true,
      value: { path: stat.path, kind: stat.kind, size: stat.size, modifiedAt: stat.modifiedAt },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function removeVaultFile(
  session: VaultSession,
  relative: unknown,
): Promise<IpcResult<null>> {
  if (!session.fs) return { ok: false, message: NO_ROOT };
  if (typeof relative !== "string") return { ok: false, message: BAD_ARGUMENT };
  try {
    // Never recursive from here. The mirror removes files it wrote, one at a
    // time; a recursive delete reachable from the renderer is a way to empty
    // a folder the app does not own.
    await session.fs.remove(relative);
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * Commit the chosen folder, if the setting says so.
 *
 * Reading the setting is the caller's job -- it lives in the preference store,
 * which this module deliberately knows nothing about -- so what arrives here is
 * an answer, not a lookup. Everything past that point is `commitVault`'s
 * decision, including the refusal to write into a repository we did not make.
 */
export async function commitVaultFolder(
  session: VaultSession,
  enabled: unknown,
): Promise<IpcResult<{ commit: WorkspaceCommit | null; reason?: string }>> {
  if (!session.root) return { ok: false, message: NO_ROOT };
  const result = await commitVault(session.root.path, enabled === true);
  return {
    ok: true,
    value: { commit: result.committed, ...(result.reason ? { reason: result.reason } : {}) },
  };
}

/** The chosen folder's commits, newest first; empty when it has no history of its own. */
export async function logVaultFolder(
  session: VaultSession,
  limit: unknown,
): Promise<IpcResult<readonly WorkspaceCommit[]>> {
  if (!session.root) return { ok: false, message: NO_ROOT };
  const n = typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 20;
  return { ok: true, value: await vaultLog(session.root.path, n) };
}

/**
 * Sync the chosen folder with its git remote. As with commits, the caller reads
 * the settings (history switch, URL, token) from the shell's stores; the page
 * sends only which action.
 */
export async function syncVaultFolder(
  session: VaultSession,
  action: unknown,
  settings: VaultSyncSettings,
): Promise<IpcResult<VaultSyncReply>> {
  if (!session.root) return { ok: false, message: NO_ROOT };
  try {
    return { ok: true, value: await syncVault(session.root.path, action, settings) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** The Overleaf links of the open folder; the token and links come from the shell's stores. */
export async function syncOverleafFolder(
  session: VaultSession,
  request: unknown,
  deps: Omit<OverleafSyncDeps, "vaultRoot">,
): Promise<IpcResult<OverleafSyncReply>> {
  if (!session.root) return { ok: false, message: NO_ROOT };
  try {
    return { ok: true, value: await syncOverleaf(request, { ...deps, vaultRoot: session.root.path }) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : BAD_ARGUMENT;
}
