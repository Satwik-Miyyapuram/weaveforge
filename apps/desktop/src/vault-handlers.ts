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

/** Adopt a directory the user picked. Refuses anything `verifyRoot` refuses. */
export async function adoptRoot(
  session: VaultSession,
  chosen: string | null,
): Promise<IpcResult<VaultRootPayload | null>> {
  // A cancelled dialog is not a failure: it is the user declining, and the
  // renderer should see the folder unchanged rather than an error.
  if (chosen === null) return { ok: true, value: session.root };

  const verdict = await verifyRoot(chosen);
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  session.root = { path: chosen, state: verdict.state };
  session.fs = new NodeWorkspaceFs(chosen);
  return { ok: true, value: session.root };
}

export function forgetRoot(session: VaultSession): IpcResult<null> {
  session.root = null;
  session.fs = null;
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

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : BAD_ARGUMENT;
}
