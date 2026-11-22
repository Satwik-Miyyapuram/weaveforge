import type { IWorkspaceFs } from "@weaveforge/core";

/** Where the browser and Android install keeps its id: the gitignored local folder, never synced. */
export const INSTALL_ID_PATH = ".weaveforge/local/install-id";

const ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * This install's stable id, created on first use. A missing or malformed file gets a fresh id. A
 * write that fails rejects, so the caller can fail closed.
 */
export async function readOrCreateInstallId(
  fs: Pick<IWorkspaceFs, "readText" | "writeFile">,
  newId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  try {
    const stored = (await fs.readText(INSTALL_ID_PATH)).trim();
    if (ID_SHAPE.test(stored)) return stored;
  } catch {
    // Absent: create one below.
  }
  const id = newId();
  await fs.writeFile(INSTALL_ID_PATH, id);
  return id;
}
