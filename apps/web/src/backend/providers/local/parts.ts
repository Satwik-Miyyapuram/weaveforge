import {
  PostgrestSettingsRepository,
  type Secrets,
  type SecretsStore,
} from "@/features/settings/infrastructure/parts";
import { desktop, type DesktopBridge, type DesktopSecretName } from "@/lib/desktop/desktop-bridge";
import { notifyWorkspaceChange } from "@/lib/parts";
import { readyCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { watchWrites } from "../postgrest/watch-writes";
import type { BackendParts } from "../postgrest/wire-postgrest-backend";
import { LocalBlobStore, localFiles } from "./parts-1";
import { deviceUserId, LocalAuthService, LocalSessionProvider } from "./local-identity";
import { createLocalClient, type LocalQuery } from "./pglite-client";

// --- local-runner ---
/**
 * The local database, from the page's side.
 *
 * The same three verbs `PgRunner` offers — `query`, `queryOne`, `exec` — so a
 * repository written against one works against the other. What is missing is
 * `run`: there is no way to hold a transaction open across several statements
 * from here, and that is deliberate rather than unfinished. PGlite is a single
 * connection; a page that could open a transaction could hold the app's only
 * connection while it sits at a breakpoint, and nothing else would run.
 *
 * Statements that must be atomic therefore belong in one statement — a CTE, or
 * a function — which is a constraint worth having: it keeps the local database
 * and the server's PostgREST path able to run the same SQL.
 */

export type LocalParam = string | number | boolean | null | Uint8Array;

/** The identity is not passed from here; see `local-db-host.ts` for why. */
export class LocalRunner {
  constructor(private readonly bridge: DesktopBridge | null = desktop()) {}

  private get shell(): DesktopBridge {
    if (!this.bridge) throw new Error("The local database is only available in the desktop app.");
    return this.bridge;
  }

  async query<T>(sql: string, params: LocalParam[] = []): Promise<T[]> {
    return (await this.shell.queryLocalDb(sql, params)) as T[];
  }

  async queryOne<T>(sql: string, params: LocalParam[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: LocalParam[] = []): Promise<void> {
    await this.query(sql, params);
  }
}

/** Straight to the shell: the default query every local backend part runs. The identity is applied on the far side. */
export function localRunnerQuery(bridge: DesktopBridge | null = desktop()): LocalQuery {
  const runner = new LocalRunner(bridge);
  return (sql, params) => runner.query(sql, params as LocalParam[]);
}

// --- device-secrets-store ---
/**
 * Integration credentials kept on the machine that holds the database.
 *
 * For a deployment with no server that can answer `/api/settings/credentials`:
 * a static export holds `src/app/api/` aside (`apps/shell/scripts/build-web.mjs`),
 * so the route is not in the bundle at all and a fetch for it reaches the
 * `app://` file handler instead. What came back was a 404 with an empty body,
 * which the route store could only turn into "Failed to save integration
 * credentials." — and because `save()` writes the secrets before the row, no
 * setting was saved either.
 *
 * The row is this *device's*, not the account's: one per machine, under
 * `LOCAL_USER_ID`, the same identity the shell applies when it opens the
 * database. It is protected by the file permissions on the app's data directory
 * and nothing else, which is what Settings tells the reader and what
 * `docs/using/desktop.md` promises. So a credential entered here does not follow
 * the account to another machine — the account's own copy is still the one the
 * website writes, through the route.
 *
 * This is deliberately not "the local-mode store". The desktop shell applies
 * `db/migrations-local` on every launch, signed in or not, so the table
 * exists either way — and the question that picks this store is whether the
 * deployment has routes of its own, never which mode a window is in.
 */
/** The keychain entry name for this device's credentials: one entry per field under it. */
export const DEVICE_SECRETS_NAME = "device-secrets" satisfies DesktopSecretName;

/**
 * Each field is one keychain entry, `device-secrets/<key>`, because Windows caps a
 * single credential blob at 2560 bytes. The entry `_index` lists the keys that make up
 * the credentials and says who wrote them (`"save"` from this page, `"move"` from the
 * one-time migration in the shell).
 */
const INDEX_KEY = "_index";

/**
 * Names the shell keeps write-only: the page never reads them back, so a listed entry with one of
 * these names is skipped on load and never read on save. Matched on the first dot segment.
 */
const WRITE_ONLY_NAMES = ["overleaf-token", "git-sync-token", "overleafToken", "gitSyncToken"];

function isWriteOnlyKey(key: string): boolean {
  const dot = key.indexOf(".");
  return WRITE_ONLY_NAMES.includes(dot < 0 ? key : key.slice(0, dot));
}

/** What the store asks of the OS keychain: named text entries, held by the shell. */
export interface DeviceKeychain {
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  clear(key: string): Promise<void>;
}

/** The help for a keychain that is missing or unusable, worded for the platform in `userAgent`. */
export function keychainHelp(userAgent: string): string {
  if (/Windows/i.test(userAgent)) {
    return "Windows Credential Manager could not be used, so nothing was saved. Sign in to Windows, check that Credential Manager opens, then try again.";
  }
  if (/Mac OS X|Macintosh/i.test(userAgent)) {
    return "The macOS keychain could not be used, so nothing was saved. Unlock the login keychain in Keychain Access, then try again.";
  }
  if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) {
    return "This computer has no keychain to keep your credentials in, so nothing was saved. Install gnome-keyring or KWallet (libsecret), then unlock it and try again. Debian/Ubuntu: sudo apt install gnome-keyring libsecret-1-0. Fedora: sudo dnf install gnome-keyring libsecret. Arch: sudo pacman -S gnome-keyring libsecret.";
  }
  return "This computer has no keychain to keep your credentials in, so nothing was saved. Install a keychain service, unlock it, and try again.";
}

/** The text a reader can act on for this machine: what to install or unlock, then try again. */
export const KEYCHAIN_HELP = keychainHelp(typeof navigator !== "undefined" ? navigator.userAgent : "");

/** Thrown when the keychain cannot take a save. Nothing is written anywhere else. */
export class KeychainUnavailableError extends Error {
  constructor() {
    super(KEYCHAIN_HELP);
    this.name = "KeychainUnavailableError";
  }
}

/** Thrown when `_index` is not the JSON the store wrote. The index is never overwritten by a save. */
export class KeychainIndexCorruptError extends Error {
  constructor() {
    super("The saved credentials index on this device is damaged, so nothing was saved. Reset it to continue.");
    this.name = "KeychainIndexCorruptError";
  }
}

/** Thrown when a save fails part way. `fields` names the entries left in an unknown state (restore failed) or the one that failed. */
export class PartialSaveError extends Error {
  constructor(readonly fields: string[], cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`The credentials were only partly saved; these entries may be out of date: ${fields.join(", ")} (${reason}).`);
    this.name = "PartialSaveError";
  }
}

/** Thrown for a top-level name the keychain cannot hold. */
export class InvalidSecretNameError extends Error {
  constructor(name: string, reason: string) {
    super(`${name} ${reason} Nothing was saved.`);
    this.name = "InvalidSecretNameError";
  }
}

/** The shell's refusal text when this machine has no keychain (`secrets.rs`). */
const NO_KEYCHAIN = /no keychain available/;

/** Maps the shell's no-keychain refusal to the typed error the settings dialog shows; any other error passes through. */
function asKeychainUnavailable(err: unknown): unknown {
  return err instanceof Error && NO_KEYCHAIN.test(err.message) ? new KeychainUnavailableError() : err;
}

/** The desktop shell's keychain entry for one key; with no shell, nothing is stored. */
export function desktopKeychain(bridge: DesktopBridge | null = desktop()): DeviceKeychain {
  const entry = (key: string): DesktopSecretName => `${DEVICE_SECRETS_NAME}/${key}`;
  return {
    // Read errors (locked keyring, unreachable keychain) propagate: the caller must never
    // treat them as "nothing saved".
    async read(key) {
      if (!bridge) return null;
      try {
        return await bridge.readSecret(entry(key));
      } catch (err) {
        throw asKeychainUnavailable(err);
      }
    },
    async write(key, text) {
      if (!bridge) throw new KeychainUnavailableError();
      try {
        await bridge.writeSecret(entry(key), text);
      } catch (err) {
        throw asKeychainUnavailable(err);
      }
    },
    async clear(key) {
      if (bridge) await bridge.clearSecret(entry(key));
    },
  };
}

function parseSecrets(text: string | undefined): Secrets {
  return JSON.parse(readyCore().localSecretsJsonText(text)) as Secrets;
}

/**
 * The credentials as keychain fields. A string field is one entry under its name; an
 * object field (the integrations, one object per provider) is one entry per sub-key,
 * `<name>.<sub>`, holding that sub-object as JSON. Empty strings are not stored.
 */
/** Windows caps one credential blob at 2560 bytes; each field is its own entry. */
export const KEYCHAIN_FIELD_LIMIT = 2560;

/** A field's size in the shell's terms: UTF-16 units times two, as Windows counts the blob. */
function fieldBytes(text: string): number {
  return text.length * 2;
}

function hexOf(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A sub-key as a keychain name part: plain alphanumerics pass; any other name is hex behind `_`. Mirrors the shell's `sub_key`. */
export function encodeSubKey(sub: string): string {
  if (/^[A-Za-z0-9]+$/.test(sub)) return sub;
  return `_${hexOf(sub)}`;
}

/** The inverse of `encodeSubKey`. */
export function decodeSubKey(part: string): string {
  if (!part.startsWith("_")) return part;
  const hex = part.slice(1);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return new TextDecoder().decode(bytes);
}

/** The top-level names the keychain accepts; a dot would be read as a sub-key separator. */
const KEYCHAIN_NAME = /^[A-Za-z0-9_-]+$/;

/** The keys an `_index` entry lists. Anything that is not the JSON the store writes is corrupt. */
function parseIndex(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new KeychainIndexCorruptError();
  }
  const keys = (parsed as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) throw new KeychainIndexCorruptError();
  return keys as string[];
}

function toFields(secrets: Secrets): Map<string, string> {
  const fields = new Map<string, string>();
  for (const [name, value] of Object.entries(secrets as Record<string, unknown>)) {
    // A dot separates a name from its sub-key, so a top-level name may not hold one.
    if (!KEYCHAIN_NAME.test(name)) throw new InvalidSecretNameError(name, "is not a name the keychain can store (letters, digits, _ and - only).");
    // `_index` is the keychain's own index entry; a credential under that name would overwrite it.
    if (name === INDEX_KEY) throw new InvalidSecretNameError(name, "is reserved for the keychain index.");
    if (typeof value === "string") {
      if (value !== "") fields.set(name, value);
    } else if (value !== null && typeof value === "object") {
      for (const [sub, inner] of Object.entries(value)) {
        if (inner !== undefined && inner !== null) fields.set(`${name}.${encodeSubKey(sub)}`, JSON.stringify(inner));
      }
    }
  }
  return fields;
}

/** Thrown by a save made before the shell has moved the old database secrets into the keychain. */
export class SecretsMovePendingError extends Error {
  readonly code = "secrets-move-pending";
}

/**
 * The shell's one-time move (`migrate097MoveSecrets`); a no-op outside the desktop app. Write-only
 * fields the move could not route are left behind: the save goes ahead (refusing it would lose the
 * first save, because the shell has already written its marker), and only their NAMES are warned.
 * The shell keeps the same names in the marker so a status view can list them.
 */
export function desktopMoveSecrets(bridge: DesktopBridge | null = desktop()): () => Promise<void> {
  return async () => {
    if (!bridge) return;
    let notMoved: string[];
    try {
      notMoved = await bridge.migrate097MoveSecrets();
    } catch (err) {
      throw asKeychainUnavailable(err);
    }
    if (notMoved.length > 0) {
      console.warn(`These saved credentials were not moved to the keychain: ${notMoved.join(", ")}.`);
    }
  };
}

/** Thrown when the index lists a field the keychain does not hold. Only the key name is in the message. */
export class KeychainFieldMissingError extends Error {
  readonly code = "keychain-field-missing";
  constructor(readonly key: string) {
    super(`The saved credential ${key} is listed in the keychain index but is missing from the keychain. Nothing was loaded for it.`);
    this.name = "KeychainFieldMissingError";
  }
}

/** Thrown when the old local database cannot be read while its folder exists. Nothing is assumed, so nothing is saved over it. */
export class LegacySecretsReadError extends Error {
  readonly code = "legacy-secrets-unreadable";
  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`The old local secrets could not be read (${reason}). Nothing was saved.`);
    this.name = "LegacySecretsReadError";
  }
}

/** Thrown when the old local database folder does not exist: there are no old secrets. Not an error for the user. */
export class LegacyDbMissingError extends Error {
  readonly code = "legacy-db-missing";
  constructor() {
    super("The old local database folder does not exist, so there are no old secrets.");
    this.name = "LegacyDbMissingError";
  }
}

/** The shell's probe: true when the old database folder exists (metadata only, the database is never opened). Outside the desktop app there is no old database, so false. */
export function desktopLegacyDbPresent(bridge: DesktopBridge | null = desktop()): () => Promise<boolean> {
  return async () => (bridge ? bridge.legacyDbPresent() : false);
}

export class DeviceSecretsStore implements SecretsStore {
  constructor(
    private readonly run: LocalQuery = localRunnerQuery(),
    private readonly keychain: DeviceKeychain = desktopKeychain(),
    private readonly moveSecrets: () => Promise<void> = desktopMoveSecrets(),
    private readonly legacyDbPresent: () => Promise<boolean> = desktopLegacyDbPresent(),
  ) {}

  /**
   * The keychain when it holds the credentials (its `_index` exists). Otherwise the old
   * local database row, read and returned but never copied: the shell's one-time migration
   * moves it. A failed keychain read throws. A failed database read is `{}` only when the
   * old database folder is gone (a fresh install); with the folder present it throws, so a
   * stopped database never reads as "no credentials".
   */
  async load(): Promise<Secrets> {
    const keys = await this.readIndex();
    if (keys !== null) return this.fromKeychain(keys);
    let legacy: string | undefined;
    try {
      legacy = await this.legacyText();
    } catch (err) {
      if (err instanceof LegacyDbMissingError) return {};
      throw err;
    }
    if (legacy === undefined) return {};
    return parseSecrets(legacy);
  }

  /** Saves into the keychain only: no file, and no database statement. Saves and resets run one at a time, in the order asked. */
  save(secrets: Secrets): Promise<void> {
    return this.serial(() => this.saveNow(secrets));
  }

  /** Runs `work` after every earlier save or reset has settled, so two saves never interleave their writes. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.queue.then(work);
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private queue: Promise<unknown> = Promise.resolve();

  private async saveNow(secrets: Secrets): Promise<void> {
    const fields = toFields(secrets);
    for (const [key, text] of fields) {
      const bytes = fieldBytes(text);
      if (bytes > KEYCHAIN_FIELD_LIMIT) {
        throw new Error(`${key} is ${bytes} bytes; the keychain holds at most ${KEYCHAIN_FIELD_LIMIT} per entry. Nothing was saved.`);
      }
    }
    let previous = await this.readIndex();
    if (previous === null) {
      // No index: the old database rows may not be moved yet. Move them first, so a save never
      // leaves them behind; if the move fails, nothing is written.
      try {
        await this.moveSecrets();
      } catch (err) {
        if (err instanceof KeychainUnavailableError) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        throw new SecretsMovePendingError(`The saved credentials are not in the keychain yet (${reason}). Nothing was saved.`);
      }
      previous = (await this.readIndex()) ?? [];
    }
    // Write-only entries are the shell's to keep: this save neither reads nor clears them.
    const listed = previous.filter((key) => !isWriteOnlyKey(key));
    // Snapshot every entry this save may touch, so a failure part way can put them back.
    const touched = [...new Set([...fields.keys(), ...listed])];
    const before = new Map<string, string | null>();
    for (const key of touched) before.set(key, await this.keychain.read(key));
    const changed: string[] = [];
    let current = "";
    try {
      for (const [key, text] of fields) {
        current = key;
        await this.keychain.write(key, text);
        changed.push(key);
      }
      for (const key of listed) {
        if (fields.has(key)) continue;
        current = key;
        await this.keychain.clear(key);
        changed.push(key);
      }
      // The index is written last, so a failed save leaves the previous index in place.
      current = INDEX_KEY;
      // Write-only names are written but not listed: the index lists only what this page reads back.
      const keys = [...fields.keys()].filter((key) => !isWriteOnlyKey(key));
      await this.keychain.write(INDEX_KEY, JSON.stringify({ source: "save", keys }));
    } catch (err) {
      // Nothing changed yet: the failure is the first write's own, so it keeps its type (for the dialog).
      if (changed.length === 0) throw err;
      const stuck: string[] = [];
      for (const key of [...changed].reverse()) {
        try {
          const old = before.get(key) ?? null;
          if (old === null) await this.keychain.clear(key);
          else await this.keychain.write(key, old);
        } catch {
          stuck.push(key);
        }
      }
      throw new PartialSaveError(stuck.length > 0 ? stuck : [current], err);
    }
  }

  /** The keys listed by `_index`, or `null` when there is no index. An unparseable index throws `KeychainIndexCorruptError`. */
  private async readIndex(): Promise<string[] | null> {
    const text = await this.keychain.read(INDEX_KEY);
    if (text === null) return null;
    return parseIndex(text);
  }

  /**
   * Clears `_index` only when it cannot be parsed, so the next save or move can run again. A readable
   * index is left alone. Returns whether it was cleared. A failed keychain read throws.
   */
  resetCorruptIndex(): Promise<boolean> {
    return this.serial(async () => {
      const text = await this.keychain.read(INDEX_KEY);
      if (text === null) return false;
      try {
        parseIndex(text);
        return false;
      } catch {
        await this.keychain.clear(INDEX_KEY);
        return true;
      }
    });
  }

  /** Rebuilds the credentials from the listed fields. A listed field the keychain lacks throws, naming only its key. */
  private async fromKeychain(keys: string[]): Promise<Secrets> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (isWriteOnlyKey(key)) continue;
      const text = await this.keychain.read(key);
      if (text === null) throw new KeychainFieldMissingError(key);
      const dot = key.indexOf(".");
      if (dot < 0) {
        out[key] = text;
        continue;
      }
      const name = key.slice(0, dot);
      const sub = key.slice(dot + 1);
      const parent = (out[name] ?? {}) as Record<string, unknown>;
      parent[decodeSubKey(sub)] = JSON.parse(text);
      out[name] = parent;
    }
    return out as Secrets;
  }

  /**
   * The row's JSON text, `undefined` when there is no row. A failed read throws
   * `LegacyDbMissingError` when the old database folder does not exist, otherwise
   * `LegacySecretsReadError`.
   */
  private async legacyText(): Promise<string | undefined> {
    // Outside the try: a core that is not loaded is a programming error, never "no database".
    const sql = readyCore().localSecretsLoadSql();
    let rows: { secrets: Secrets | string | null }[];
    try {
      rows = (await this.run(sql, [LOCAL_USER_ID])) as {
        secrets: Secrets | string | null;
      }[];
    } catch (err) {
      if (!(await this.legacyDbPresent())) throw new LegacyDbMissingError();
      throw new LegacySecretsReadError(err);
    }
    const stored = rows[0]?.secrets;
    if (stored === undefined || stored === null) return undefined;
    return typeof stored === "string" ? stored : JSON.stringify(stored);
  }
}

// --- wire-local-backend ---
/**
 * The three things that make the app run on this computer alone.
 *
 * The repositories are untouched: they get a client with the same shape, an
 * identity that answers without a session, and a blob store that keeps bytes
 * in the local database. Writes are wrapped the same way as the PostgREST
 * client's, so the folder mirror, the local HTTP surface and the MCP server
 * hear about a local edit exactly as they hear about a synced one.
 *
 * The settings repository is the account one with the credentials store swapped,
 * not a subclass: the difference was never the mode, only where secrets can
 * live. See `DeviceSecretsStore`.
 */
export function localBackendParts(query: LocalQuery = localRunnerQuery()): BackendParts {
  const db = watchWrites(createLocalClient(query) as unknown as SupabaseClient, notifyWorkspaceChange);
  // The shell may run this database as the account the device was adopted by.
  const session = new LocalSessionProvider(() => deviceUserId(query));
  return {
    db,
    session,
    settingsRepository: new PostgrestSettingsRepository(db, session, new DeviceSecretsStore(query)),
    // Offline copies never show server notices.
    releaseNotices: { unseen: async () => null },
    auth: new LocalAuthService(),
    blobStore: new LocalBlobStore(query, localFiles(desktop())),
  };
}
