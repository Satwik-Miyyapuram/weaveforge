import { readFile } from "node:fs/promises";

/**
 * A whole small file, or `null` when there is none.
 *
 * Only a missing file is "nothing". A file that is there but cannot be read
 * right now — locked by an antivirus scan, busy, denied — throws, because a
 * store that read it as empty would write back a copy holding only its own
 * change and lose everything else in it.
 */
export async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
