import { app, safeStorage } from "electron";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { PreferenceStore } from "./preference-store";
import { SecretStore } from "./secret-store";
import { temporaryName } from "./write-queue";

/**
 * The shell's two on-disk stores — settings and secrets — and the whole-file
 * write they share. Out of `main.ts` so the shell's wiring stays the wiring:
 * both are factories the IPC handlers call per request, for the reasons on
 * each.
 */

/**
 * The shell's settings file, opened on each call.
 *
 * A factory rather than a value because `getPath` needs an app that is ready,
 * and this module is evaluated before that. Reading the file per call also
 * means a second window — or a second instance that lost the lock race — never
 * writes back a copy it read minutes ago.
 */
export function preferenceStore(): PreferenceStore {
  const file = path.join(app.getPath("userData"), "preferences.json");
  return new PreferenceStore({
    read: () => readFile(file, "utf8").catch(() => null),
    write: (contents) => writeWhole(file, contents),
  });
}

/**
 * Written beside and renamed over: a crash mid-write leaves the old file, not
 * half of the new one. These two files are read at every start.
 *
 * The draft's name is unique per write rather than per process, which the pid
 * alone is not: two writes in this process picked the same name, so the loser's
 * rename published the winner's bytes and one of the two changes disappeared.
 * `temporaryName` has the counter and the random suffix; the queue in
 * `write-queue.ts` is what keeps two writes from overlapping in the first
 * place, and this is the belt to that pair of braces — a draft left behind by a
 * killed process must not be one a later write can collide with either.
 */
async function writeWhole(
  file: string,
  contents: string,
  mode?: number,
): Promise<void> {
  const draft = `${file}.${temporaryName()}`;
  await writeFile(draft, contents, { encoding: "utf8", mode });
  await rename(draft, file);
}

/**
 * The keychain, wired to `safeStorage` and one file in the app's own data
 * directory.
 *
 * The path is resolved lazily rather than at module load: `getPath` needs a
 * ready app, and this module is evaluated before `whenReady`. Nothing readable
 * is written — see `secret-store.ts` for what the file contains and what
 * happens on a machine with no keychain backend.
 */
export function secretStore(): SecretStore {
  const file = path.join(app.getPath("userData"), "secrets.json");
  return new SecretStore(safeStorage, {
    read: () => readFile(file, "utf8").catch(() => null),
    write: (contents) => writeWhole(file, contents, 0o600),
  });
}

