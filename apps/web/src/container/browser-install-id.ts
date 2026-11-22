import type { IWorkspaceFs } from "@weaveforge/core";
import { ID_SHAPE } from "@/features/migration-097/domain/install-id-shape";

/** Where the browser and Android install keeps its id: the gitignored local folder, never synced. */
export const INSTALL_ID_PATH = ".weaveforge/local/install-id";

const LOCK_NAME = "wf-install-id";

/**
 * This install's stable id, created on first use. A missing or malformed file gets a fresh id.
 *
 * The new id is written to a temp file, renamed into place, then read back, and the read-back id is
 * returned. When navigator.locks exists the whole read-or-create runs under that lock, which
 * serialises tabs. Without the lock the race between tabs is narrowed, not closed. A lost race
 * fails closed (the rename or read throws) and is recovered by re-running the export. A write that
 * fails rejects, so the caller can fail closed too.
 */
export async function readOrCreateInstallId(
  fs: Pick<IWorkspaceFs, "readText" | "writeFile" | "rename">,
  newId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const locks = globalThis.navigator?.locks;
  if (locks) {
    let granted = false;
    try {
      return await locks.request(LOCK_NAME, () => {
        granted = true;
        return readOrCreateUnlocked(fs, newId);
      });
    } catch (error) {
      // A denied lock (SecurityError) that was never granted falls back to the unlocked path.
      // Any other failure, or one raised by the file work itself, still fails closed.
      if (granted || (error as { name?: unknown } | null)?.name !== "SecurityError") throw error;
    }
  }
  return readOrCreateUnlocked(fs, newId);
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
  const temp = `${INSTALL_ID_PATH}.part`;
  await fs.writeFile(temp, newId());
  await fs.rename(temp, INSTALL_ID_PATH);
  const readBack = (await fs.readText(INSTALL_ID_PATH)).trim();
  if (!ID_SHAPE.test(readBack)) throw new Error("install id: stored id is malformed");
  return readBack;
}
