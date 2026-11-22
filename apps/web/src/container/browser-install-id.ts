import type { IWorkspaceFs } from "@weaveforge/core";
import { ID_SHAPE } from "@/features/migration-097/domain/install-id-shape";

/** Where the browser and Android install keeps its id: the gitignored local folder, never synced. */
export const INSTALL_ID_PATH = ".weaveforge/local/install-id";

const LOCK_NAME = "wf-install-id";

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
  fs: Pick<IWorkspaceFs, "readText" | "writeFile" | "rename">,
  newId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const locks = globalThis.navigator?.locks;
  // No unlocked fallback: two tabs could each keep a different id. Refuse instead.
  if (!locks) throw new Error("install id: navigator.locks is unavailable, so no id is created without the lock");
  return locks.request(LOCK_NAME, () => readOrCreateUnlocked(fs, newId));
}

async function readOrCreateUnlocked(
  fs: Pick<IWorkspaceFs, "readText" | "writeFile" | "rename">,
  newId: () => string,
): Promise<string> {
  try {
    const stored = (await fs.readText(INSTALL_ID_PATH)).trim();
    if (ID_SHAPE.test(stored)) return stored;
  } catch {
    // Absent: create one below.
  }
  // A unique name per call, so two tabs or two calls never write the same temp file.
  const temp = `${INSTALL_ID_PATH}.${crypto.randomUUID()}.part`;
  await fs.writeFile(temp, newId());
  await fs.rename(temp, INSTALL_ID_PATH);
  const readBack = (await fs.readText(INSTALL_ID_PATH)).trim();
  if (!ID_SHAPE.test(readBack)) throw new Error("install id: stored id is malformed");
  return readBack;
}
