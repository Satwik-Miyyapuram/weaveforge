import fs from "node:fs";
import path from "node:path";

/**
 * The one setting that has to outlive the app: where the workspace folder is.
 *
 * Everything else the shell remembers lives under its own directory
 * (`preferences.json`, the local database), and uninstalling can take that
 * directory with it. The workspace folder is different — it is a folder the
 * person chose, full of their own markdown and, since `local-db-backup.ts`,
 * copies of the database — and a fresh install that does not know where it
 * is has lost the way back to everything. So its path is also written to a
 * small file under the home directory, `~/.weaveforge/desktop.json`, which no
 * installer touches. A fresh install with no preferences reads it and picks
 * the folder up again, backups and all.
 *
 * Nothing else goes in here. It is a pointer, not a second preferences file.
 */

export const HOME_CONFIG_DIR = ".weaveforge";
export const HOME_CONFIG_FILE = "desktop.json";

export interface HomeConfig {
  vaultRoot: string | null;
}

export function homeConfigPath(home: string): string {
  return path.join(home, HOME_CONFIG_DIR, HOME_CONFIG_FILE);
}

/** What the file says, or an empty config for a file that is not there or not JSON. */
export async function readHomeConfig(home: string): Promise<HomeConfig> {
  try {
    const parsed: unknown = JSON.parse(await fs.promises.readFile(homeConfigPath(home), "utf8"));
    const root =
      parsed && typeof parsed === "object" && "vaultRoot" in parsed
        ? (parsed as { vaultRoot: unknown }).vaultRoot
        : null;
    return { vaultRoot: typeof root === "string" && root.length > 0 ? root : null };
  } catch {
    return { vaultRoot: null };
  }
}

/**
 * Write the config, whole. Beside-and-rename like every other file the shell
 * reads at boot, so a crash mid-write leaves the old pointer, not half of one.
 * A write that fails is swallowed: the preference file still has the path,
 * and a home directory that cannot be written is not worth stopping over.
 */
export async function writeHomeConfig(home: string, config: HomeConfig): Promise<void> {
  const file = homeConfigPath(home);
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const draft = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(draft, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await fs.promises.rename(draft, file);
  } catch {
    // See above.
  }
}
