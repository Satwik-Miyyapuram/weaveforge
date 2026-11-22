import type { IWorkspaceFs } from "@weaveforge/core";
import { ID_SHAPE } from "@/features/migration-097/domain/install-id-shape";

/** Where the browser and Android install keeps its id: the gitignored local folder, never synced. */
export const INSTALL_ID_PATH = ".weaveforge/local/install-id";

const LOCK_NAME = "wf-install-id";

/** The file access the install id needs. `remove` is optional: it only clears a temp file after a failed rename. */
export type InstallIdFs = Pick<IWorkspaceFs, "readText" | "writeFile" | "rename"> & Partial<Pick<IWorkspaceFs, "remove">>;

/**
 * This install's stable id, created on first use. A missing or malformed file gets a fresh id.
 *
 * The new id is written to a uniquely named temp file, renamed over the id file, then read back, and
 * the read-back id is returned. BrowserWorkspaceFs.rename is a copy, an overwrite and a delete, not an
 * atomic move, so the read-back is what the caller gets, whichever id ended up stored. The whole
 * read-or-create runs under navigator.locks, which serialises tabs. A write that fails rejects, so
 * the caller can fail closed too.
 */
export async function readOrCreateInstallId(
  fs: InstallIdFs,
  newId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const locks = globalThis.navigator?.locks;
  // No unlocked fallback: two tabs could each keep a different id. Refuse instead.
  if (!locks) throw new Error("install id: navigator.locks is unavailable, so no id is created without the lock");
  return locks.request(LOCK_NAME, () => readOrCreateUnlocked(fs, newId));
}

/** True for a missing file: the ENOENT code, the NotFoundError name, or BrowserWorkspaceFs's "ENOENT:" message. */
function isNotFound(error: unknown): boolean {
  const { code, name, message } = (error ?? {}) as { code?: unknown; name?: unknown; message?: unknown };
  return code === "ENOENT" || name === "NotFoundError" || (typeof message === "string" && message.startsWith("ENOENT:"));
}

async function readOrCreateUnlocked(
  fs: InstallIdFs,
  newId: () => string,
): Promise<string> {
  let stored: string | undefined;
  try {
    stored = (await fs.readText(INSTALL_ID_PATH)).trim();
  } catch (error) {
    // Only a missing file is absent. Any other read error refuses, so a transient failure never rotates the id.
    if (!isNotFound(error)) throw error;
  }
  if (stored !== undefined && ID_SHAPE.test(stored)) return stored;
  // A unique name per call, so two tabs or two calls never write the same temp file.
  const temp = `${INSTALL_ID_PATH}.${crypto.randomUUID()}.part`;
  await fs.writeFile(temp, newId());
  try {
    await fs.rename(temp, INSTALL_ID_PATH);
  } catch (error) {
    // Best effort: a stranded temp file is harmless to the id, so a failed cleanup must not mask the rename error.
    try {
      await fs.remove?.(temp);
    } catch {
      // Ignored: the rename error is the one the caller needs.
    }
    throw error;
  }
  const readBack = (await fs.readText(INSTALL_ID_PATH)).trim();
  if (!ID_SHAPE.test(readBack)) throw new Error("install id: stored id is malformed");
  return readBack;
}
