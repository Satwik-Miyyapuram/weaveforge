import type { IWorkspaceFs } from "@weaveforge/core";

/** Where the browser and Android install keeps its id: the gitignored local folder, never synced. */
export const INSTALL_ID_PATH = ".weaveforge/local/install-id";

const ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * This install's stable id, created on first use. A missing or malformed file gets a fresh id. The
 * new id is written to a temp file and renamed into place, then read back, so two tabs that create
 * one at the same moment both return the id that ended up stored. A write that fails rejects, so
 * the caller can fail closed.
 */
export async function readOrCreateInstallId(
  fs: Pick<IWorkspaceFs, "readText" | "writeFile" | "rename">,
  newId: () => string = () => crypto.randomUUID(),
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
