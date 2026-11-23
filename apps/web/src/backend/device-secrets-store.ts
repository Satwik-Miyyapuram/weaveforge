import {
  type Secrets,
  type SecretsStore,
} from "@/features/settings/infrastructure/parts";
import { desktop, type DesktopBridge, type DesktopSecretName } from "@/lib/desktop/desktop-bridge";

/** The keychain entry name for this device's credentials: one entry per field under it. */
export const DEVICE_SECRETS_NAME = "device-secrets" satisfies DesktopSecretName;

/**
 * Each field is one keychain entry, `device-secrets/<key>`, because Windows caps a
 * single credential blob at 2560 bytes. The entry `_index` lists the keys that make up
 * the credentials and says who wrote them.
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

/** One keychain per shell bridge, so every store on this device shares one save queue. */
const keychainsByBridge = new WeakMap<DesktopBridge, DeviceKeychain>();

/** The desktop shell's keychain entry for one key; with no shell, nothing is stored. */
export function desktopKeychain(bridge: DesktopBridge | null = desktop()): DeviceKeychain {
  if (!bridge) return makeDesktopKeychain(null);
  let keychain = keychainsByBridge.get(bridge);
  if (!keychain) keychainsByBridge.set(bridge, (keychain = makeDesktopKeychain(bridge)));
  return keychain;
}

function makeDesktopKeychain(bridge: DesktopBridge | null): DeviceKeychain {
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

/** The inverse of `encodeSubKey`. A part this store could not have written throws `KeychainIndexCorruptError`. */
export function decodeSubKey(part: string): string {
  if (!part.startsWith("_")) {
    if (!/^[A-Za-z0-9]+$/.test(part)) throw new KeychainIndexCorruptError();
    return part;
  }
  const hex = part.slice(1);
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new KeychainIndexCorruptError();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new KeychainIndexCorruptError();
  }
}

/** The top-level names the keychain accepts; a dot would be read as a sub-key separator. */
const KEYCHAIN_NAME = /^[A-Za-z0-9_-]+$/;

/** Object-prototype slots: never a credential name, so loading can never write into a prototype. */
const UNSAFE_NAMES = new Set(["__proto__", "constructor", "prototype"]);

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
    if (UNSAFE_NAMES.has(name)) throw new InvalidSecretNameError(name, "is not a name the keychain can store.");
    if (typeof value === "string") {
      if (value !== "") fields.set(name, value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [sub, inner] of Object.entries(value)) {
        if (UNSAFE_NAMES.has(sub)) throw new InvalidSecretNameError(`${name}.${sub}`, "is not a name the keychain can store.");
        if (inner !== undefined && inner !== null) fields.set(`${name}.${encodeSubKey(sub)}`, JSON.stringify(inner));
      }
    } else if (value !== null && value !== undefined) {
      // A number, boolean or array would be dropped or reshaped on the way back; refuse it.
      throw new InvalidSecretNameError(name, "holds a value the keychain cannot store (text or an object of fields only).");
    }
  }
  return fields;
}

/** How long one keychain call may take before it is given up, so a hung shell never blocks the queue. */
export const KEYCHAIN_CALL_TIMEOUT_MS = 60_000;

/** Thrown when one keychain call gets no answer in time. Only the key name is in the message. */
export class KeychainTimeoutError extends Error {
  readonly code = "keychain-timeout";
  constructor(readonly key: string, ms: number) {
    super(`The keychain did not answer for ${key} within ${Math.round(ms / 1000)} s. Try again.`);
    this.name = "KeychainTimeoutError";
  }
}

/** Rejects with `KeychainTimeoutError` after `ms`; the call itself is not cancelled and may still land. */
function timed<T>(work: Promise<T>, key: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new KeychainTimeoutError(key, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** What a load read, and the listed keys it skipped because they were missing or not readable. */
export interface DeviceSecretsLoad {
  secrets: Secrets;
  skipped: string[];
}

/** The tail of each keychain's save/load queue, shared by every store on that keychain. */
const queues = new WeakMap<DeviceKeychain, Promise<unknown>>();

/** The device credentials, kept in the OS keychain only. */
export class DeviceSecretsStore implements SecretsStore {
  /** The keychain with each call bounded by the timeout. `keychain` itself keys the shared queue. */
  private readonly calls: DeviceKeychain;

  constructor(
    private readonly keychain: DeviceKeychain = desktopKeychain(),
    timeoutMs: number = KEYCHAIN_CALL_TIMEOUT_MS,
  ) {
    this.calls = {
      read: (key) => timed(keychain.read(key), key, timeoutMs),
      write: (key, text) => timed(keychain.write(key, text), key, timeoutMs),
      clear: (key) => timed(keychain.clear(key), key, timeoutMs),
    };
  }

  /** The keychain's credentials when its `_index` exists; otherwise nothing. A failed read throws. */
  async load(): Promise<Secrets> {
    return (await this.loadWithSkipped()).secrets;
  }

  /** Like `load`, and also names the listed keys that were missing or not readable, so the UI can ask for them again. */
  loadWithSkipped(): Promise<DeviceSecretsLoad> {
    // Queued behind any running save, so a load never sees half a save.
    return this.serial(async () => {
      const keys = await this.readIndex();
      if (keys === null) return { secrets: {}, skipped: [] };
      return this.fromKeychain(keys);
    });
  }

  /** Saves into the keychain only: no file, and no database statement. Saves and resets run one at a time, in the order asked. */
  save(secrets: Secrets): Promise<void> {
    return this.serial(() => this.saveNow(secrets));
  }

  /**
   * Runs `work` after every earlier save or reset on the same keychain has settled, so two saves
   * never interleave their writes, even from two store instances.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const turn = (queues.get(this.keychain) ?? Promise.resolve()).then(work);
    queues.set(this.keychain, turn.catch(() => undefined));
    return turn;
  }

  private async saveNow(secrets: Secrets): Promise<void> {
    const fields = toFields(secrets);
    // Write-only names are written but not listed: the index lists only what this page reads back.
    const indexJson = JSON.stringify({ source: "save", keys: [...fields.keys()].filter((key) => !isWriteOnlyKey(key)) });
    // The index is checked with the fields, so a save never fails on it after every field is written.
    for (const [key, text] of [...fields, [INDEX_KEY, indexJson] as const]) {
      const bytes = fieldBytes(text);
      if (bytes > KEYCHAIN_FIELD_LIMIT) {
        throw new Error(`${key} is ${bytes} bytes; the keychain holds at most ${KEYCHAIN_FIELD_LIMIT} per entry. Nothing was saved.`);
      }
    }
    const indexText = await this.calls.read(INDEX_KEY);
    const previous = indexText === null ? [] : parseIndex(indexText);
    // Write-only entries are the shell's to keep: this save never reads them, never clears them
    // and never rolls them back.
    const listed = previous.filter((key) => !isWriteOnlyKey(key));
    // Snapshot every entry this save may touch (the index too), so a failure part way can put them back.
    const touched = [...new Set([...fields.keys(), ...listed])].filter((key) => !isWriteOnlyKey(key));
    const before = new Map<string, string | null>([[INDEX_KEY, indexText]]);
    for (const key of touched) before.set(key, await this.calls.read(key));
    // A key goes in `changed` before its write, so an entry a failed write may have half-written is restored too.
    const changed: string[] = [];
    // Write-only entries written before a failure keep the new value (never rolled back), so the error names them.
    const kept: string[] = [];
    let done = 0;
    let current = "";
    try {
      for (const [key, text] of fields) {
        current = key;
        const writeOnly = isWriteOnlyKey(key);
        if (!writeOnly) changed.push(key);
        await this.calls.write(key, text);
        if (writeOnly) kept.push(key);
        done++;
      }
      // The index is written after the fields and before any dropped field is cleared, so a crash
      // at any point leaves an index whose every listed field exists; a stray dropped entry is a
      // harmless orphan.
      current = INDEX_KEY;
      changed.push(INDEX_KEY);
      await this.calls.write(INDEX_KEY, indexJson);
      done++;
      for (const key of listed) {
        if (fields.has(key)) continue;
        current = key;
        changed.push(key);
        await this.calls.clear(key);
      }
    } catch (err) {
      const stuck: string[] = [];
      for (const key of [...changed].reverse()) {
        try {
          await this.restore(key, before);
        } catch {
          stuck.push(key);
        }
      }
      // The first write failed and its entry was put back: nothing was saved, so the failure keeps
      // its own type (for the dialog).
      if (done === 0 && stuck.length === 0) throw err;
      // A write-only entry is never put back, so one whose own write failed is always named.
      const named = stuck.length > 0 ? stuck : [current];
      if (isWriteOnlyKey(current) && !named.includes(current)) named.push(current);
      throw new PartialSaveError([...named, ...kept], err);
    }
  }

  /** Puts one entry back to its snapshot: cleared when it did not exist before. */
  private async restore(key: string, before: Map<string, string | null>): Promise<void> {
    const old = before.get(key) ?? null;
    if (old === null) await this.calls.clear(key);
    else await this.calls.write(key, old);
  }

  /** The keys listed by `_index`, or `null` when there is no index. An unparseable index throws `KeychainIndexCorruptError`. */
  private async readIndex(): Promise<string[] | null> {
    const text = await this.calls.read(INDEX_KEY);
    if (text === null) return null;
    return parseIndex(text);
  }

  /**
   * Clears `_index` only when it cannot be parsed, so the next save or move can run again. A readable
   * index is left alone. Returns whether it was cleared. A failed keychain read throws.
   */
  resetCorruptIndex(): Promise<boolean> {
    return this.serial(async () => {
      const text = await this.calls.read(INDEX_KEY);
      if (text === null) return false;
      try {
        parseIndex(text);
        return false;
      } catch {
        await this.calls.clear(INDEX_KEY);
        return true;
      }
    });
  }

  /** Rebuilds the credentials from the listed fields. A listed field that is missing or not readable is skipped, logging only its key. */
  private async fromKeychain(keys: string[]): Promise<DeviceSecretsLoad> {
    const out: Record<string, unknown> = {};
    const skipped: string[] = [];
    for (const key of keys) {
      if (isWriteOnlyKey(key)) continue;
      const dot = key.indexOf(".");
      const name = dot < 0 ? key : key.slice(0, dot);
      const sub = dot < 0 ? "" : decodeSubKey(key.slice(dot + 1));
      // An index naming the index itself, a name the store refuses on save, or an object-prototype slot
      // is not one this store wrote.
      if (name === INDEX_KEY || !KEYCHAIN_NAME.test(name) || UNSAFE_NAMES.has(name) || UNSAFE_NAMES.has(sub)) {
        throw new KeychainIndexCorruptError();
      }
      // A name listed both as text and as fields is not one this store wrote.
      const has = Object.hasOwn(out, name);
      if (has && (dot < 0 || typeof out[name] !== "object")) throw new KeychainIndexCorruptError();
      const text = await this.calls.read(key);
      if (text === null) {
        // A save that stopped part way (or an entry removed outside the app) leaves a listed field
        // missing. Skipping it keeps every other credential loadable; the next save drops it from
        // the index. Only the key name is logged, never a value.
        console.warn(`Saved credential ${key} is listed in the keychain index but missing; skipped.`);
        skipped.push(key);
        continue;
      }
      if (dot < 0) {
        out[name] = text;
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        // Not the JSON this store wrote: skipped like a missing field, so the other credentials still load.
        console.warn(`Saved credential ${key} in the keychain cannot be read; skipped.`);
        skipped.push(key);
        continue;
      }
      const parent = (has ? out[name] : {}) as Record<string, unknown>;
      parent[sub] = value;
      out[name] = parent;
    }
    return { secrets: out as Secrets, skipped };
  }
}
