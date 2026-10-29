import type { IpcResult } from "./channels";
import { WriteQueue } from "./write-queue";

/**
 * The handful of settings that belong to the shell rather than to the app.
 *
 * They are here because the renderer cannot keep them: `vault-git` decides whether the folder is
 * committed to, and a setting that decides that has to be answered before the
 * first mirror run rather than after it; `sync-target` decides which server the
 * app talks to, which is a question that has to be answered before there is a
 * session to answer it from (`docs/internal/plans/completed/offline-first-sync.md` D2, D7).
 *
 * Deliberately *not* encrypted, and deliberately not in `secret-store.ts`. That
 * store exists to keep a credential from being readable at rest; a boolean
 * about a git mirror and a server address are not credentials, and sealing
 * them would buy nothing while implying the file holds something it does not.
 * Secrets go through the keychain; preferences go in a plain file beside it.
 */

export const PREFERENCE_NAMES = [
  "sync-target",
  "vault-root",
  "vault-git",
  "local-api",
  "plan-widget",
  "plan-widget-bounds",
  "plan-widget-theme",
] as const;
export type PreferenceName = (typeof PREFERENCE_NAMES)[number];

/** What a preference may be. Anything else is a bug on the calling side. */
export type PreferenceValue = string | boolean | null;

const UNKNOWN_NAME = "That is not something this app remembers.";
const BAD_VALUE = "A preference is a string, a boolean, or nothing.";
const UNREADABLE = "The preferences file could not be read just now, so nothing was changed.";

/**
 * The file, injected so the rules can be tested without a disk or an app.
 * `read` answers `null` for no file and throws when there is one it cannot read.
 */
export interface PreferenceFile {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

export class PreferenceStore {
  /**
   * Reads do not queue; writes do.
   *
   * A read overlapping a write gets the file as it was or as it became, and
   * both are answers. It is the read-modify-write *cycle* that has to be one
   * thing, so only a write runs one.
   */
  private readonly writes = new WriteQueue();

  constructor(private readonly file: PreferenceFile) {}

  async read(name: unknown): Promise<IpcResult<PreferenceValue>> {
    if (!isName(name)) return { ok: false, message: UNKNOWN_NAME };
    const all = await this.load().catch(() => ({}) as Record<string, unknown>);
    const value = all[name];
    // An unreadable or unexpected value reads as absent rather than as an
    // error: a preference file someone has edited by hand should cost them the
    // preference, not the launch.
    return { ok: true, value: isValue(value) ? value : null };
  }

  async write(name: unknown, value: unknown): Promise<IpcResult<null>> {
    if (!isName(name)) return { ok: false, message: UNKNOWN_NAME };
    if (!isValue(value)) return { ok: false, message: BAD_VALUE };
    return this.writes.run(async () => {
      // A file that is there but cannot be read right now (locked, busy) is
      // not an empty one: writing back only this key would wipe the rest (38-01).
      let all: Record<string, unknown>;
      try {
        all = await this.load();
      } catch {
        return { ok: false, message: UNREADABLE };
      }
      if (value === null) delete all[name];
      else all[name] = value;
      await this.file.write(`${JSON.stringify(all, null, 2)}\n`);
      return { ok: true, value: null };
    });
  }

  /**
   * Everything on file, or nothing if there is no file or its contents are not
   * preferences. A file that cannot be read at all throws.
   */
  private async load(): Promise<Record<string, unknown>> {
    const contents = await this.file.read();
    if (!contents) return {};
    try {
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function isName(name: unknown): name is PreferenceName {
  return typeof name === "string" && (PREFERENCE_NAMES as readonly string[]).includes(name);
}

function isValue(value: unknown): value is PreferenceValue {
  return value === null || typeof value === "string" || typeof value === "boolean";
}

/**
 * The preferences the page may write over IPC. The rest are the shell's own
 * (`vault-root`, `local-api`, the plan widget's) and written only from this
 * side; `vault-root` in particular decides which folder the shell serves files
 * from, so a page that could set it could point the shell anywhere. The page
 * reads none of them. Mirrored by `DesktopPreferenceName` in the web bridge,
 * and a test holds the two equal.
 */
export const PAGE_WRITABLE = ["vault-git"] as const satisfies readonly PreferenceName[];
export type PageWritablePreference = (typeof PAGE_WRITABLE)[number];

/** The preferences as the page sees them: writes behind the list, no reads. */
export function pagePreferences(store: Pick<PreferenceStore, "write">) {
  return {
    write: async (name: unknown, value: unknown): Promise<IpcResult<null>> =>
      isName(name) && (PAGE_WRITABLE as readonly PreferenceName[]).includes(name)
        ? store.write(name, value)
        : { ok: false, message: UNKNOWN_NAME },
  };
}
