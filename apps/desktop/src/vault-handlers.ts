import type { IpcResult, VaultEntryPayload, VaultRootPayload } from "./channels";
import { NodeWorkspaceFs, verifyRoot } from "./vault-folder";

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

export interface VaultSession {
  root: VaultRootPayload | null;
  fs: NodeWorkspaceFs | null;
}

export function newVaultSession(): VaultSession {
  return { root: null, fs: null };
}

/** Told when the chosen folder changes, so it can outlive the process. */
export type RememberRoot = (root: string | null) => void;

/** Adopt a directory the user picked. Refuses anything `verifyRoot` refuses. */
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

export function forgetRoot(session: VaultSession, remember?: RememberRoot): IpcResult<null> {
  session.root = null;
  session.fs = null;
  remember?.(null);
  return { ok: true, value: null };
}

export function currentRoot(session: VaultSession): IpcResult<VaultRootPayload | null> {
  return { ok: true, value: session.root };
}

export async function readVaultFile(
  session: VaultSession,
  relative: unknown,
): Promise<IpcResult<string | null>> {
  if (!session.fs) return { ok: false, message: NO_ROOT };
  if (typeof relative !== "string") return { ok: false, message: BAD_ARGUMENT };
  try {
    return { ok: true, value: await session.fs.readText(relative) };
  } catch (error) {
    // A missing file is a `null`, not a failure — callers ask about files that
    // may not exist yet. Anything else is a refusal with its reason.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
    return { ok: false, message: messageOf(error) };
  }
}

export async function writeVaultFile(
  session: VaultSession,
  relative: unknown,
  contents: unknown,
): Promise<IpcResult<null>> {
  if (!session.fs) return { ok: false, message: NO_ROOT };
  if (typeof relative !== "string" || typeof contents !== "string") {
    return { ok: false, message: BAD_ARGUMENT };
  }
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

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : BAD_ARGUMENT;
}
