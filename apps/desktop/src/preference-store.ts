import type { IpcResult } from "./channels";

/**
 * The handful of settings that belong to the shell rather than to the app.
 *
 * Two of them, and both are here for the same reason: the renderer cannot keep
 * them. `sync-offer-shown` has to survive a reinstall-over-upgrade, or the
 * one-time offer stops being one-time; `sync-target` decides which server the
 * app talks to, which is a question that has to be answered before there is a
 * session to answer it from (`docs/plans/future/offline-first-sync.md` D2, D7).
 *
 * Deliberately *not* encrypted, and deliberately not in `secret-store.ts`. That
 * store exists to keep a credential from being readable at rest; a boolean
 * about a dismissed card and a server address are not credentials, and sealing
 * them would buy nothing while implying the file holds something it does not.
 * Secrets go through the keychain; preferences go in a plain file beside it.
 */

export const PREFERENCE_NAMES = ["sync-offer-shown", "sync-target", "vault-root"] as const;
export type PreferenceName = (typeof PREFERENCE_NAMES)[number];

/** What a preference may be. Anything else is a bug on the calling side. */
export type PreferenceValue = string | boolean | null;

const UNKNOWN_NAME = "That is not something this app remembers.";
const BAD_VALUE = "A preference is a string, a boolean, or nothing.";

/** The file, injected so the rules can be tested without a disk or an app. */
export interface PreferenceFile {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

export class PreferenceStore {
  constructor(private readonly file: PreferenceFile) {}

  async read(name: unknown): Promise<IpcResult<PreferenceValue>> {
    if (!isName(name)) return { ok: false, message: UNKNOWN_NAME };
    const all = await this.load();
    const value = all[name];
    // An unreadable or unexpected value reads as absent rather than as an
    // error: a preference file someone has edited by hand should cost them the
    // preference, not the launch.
    return { ok: true, value: isValue(value) ? value : null };
  }

  async write(name: unknown, value: unknown): Promise<IpcResult<null>> {
    if (!isName(name)) return { ok: false, message: UNKNOWN_NAME };
    if (!isValue(value)) return { ok: false, message: BAD_VALUE };

    const all = await this.load();
    if (value === null) delete all[name];
    else all[name] = value;
    await this.file.write(`${JSON.stringify(all, null, 2)}\n`);
    return { ok: true, value: null };
  }

  /** Everything on file, or nothing if there is no file or it is not readable. */
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
