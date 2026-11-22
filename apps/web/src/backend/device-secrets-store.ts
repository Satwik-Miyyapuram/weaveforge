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

/** What the store asks of the OS keychain: named text entries, held by the shell. */
export interface DeviceKeychain {
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  clear(key: string): Promise<void>;
}

/** The text a reader can act on: what to install, then try again. */
export const KEYCHAIN_HELP =
  "This computer has no keychain to keep your credentials in, so nothing was saved. On Linux, install gnome-keyring or KWallet (libsecret), then unlock it and try again. Debian/Ubuntu: sudo apt install gnome-keyring libsecret-1-0. Fedora: sudo dnf install gnome-keyring libsecret. Arch: sudo pacman -S gnome-keyring libsecret.";

/** Thrown when the keychain cannot take a save. Nothing is written anywhere else. */
export class KeychainUnavailableError extends Error {
  constructor() {
    super(KEYCHAIN_HELP);
    this.name = "KeychainUnavailableError";
  }
}

/** The shell's refusal text when this machine has no keychain (`secrets.rs`). */
const NO_KEYCHAIN = /no keychain available/;

/** The desktop shell's keychain entry for one key; with no shell, nothing is stored. */
export function desktopKeychain(bridge: DesktopBridge | null = desktop()): DeviceKeychain {
  const entry = (key: string): DesktopSecretName => `${DEVICE_SECRETS_NAME}/${key}`;
  return {
    // Read errors (locked keyring, unreachable keychain) propagate: the caller must never
    // treat them as "nothing saved".
    async read(key) {
      return bridge ? bridge.readSecret(entry(key)) : null;
    },
    async write(key, text) {
      if (!bridge) throw new KeychainUnavailableError();
      try {
        await bridge.writeSecret(entry(key), text);
      } catch (err) {
        if (err instanceof Error && NO_KEYCHAIN.test(err.message)) {
          throw new KeychainUnavailableError();
        }
        throw err;
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

/**
 * The credentials as keychain fields. A string field is one entry under its name; an
 * object field (the integrations, one object per provider) is one entry per sub-key,
 * `<name>.<sub>`, holding that sub-object as JSON. Empty strings are not stored.
 */
function toFields(secrets: Secrets): Map<string, string> {
  const fields = new Map<string, string>();
  for (const [name, value] of Object.entries(secrets as Record<string, unknown>)) {
    // A dot separates a name from its sub-key, so a top-level name may not hold one.
    if (!KEYCHAIN_NAME.test(name)) throw new Error(`${name} is not a name the keychain can store (letters, digits, _ and - only). Nothing was saved.`);
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

/** The device credentials, kept in the OS keychain only. */
export class DeviceSecretsStore implements SecretsStore {
  constructor(private readonly keychain: DeviceKeychain = desktopKeychain()) {}

  /** The keychain's credentials when its `_index` exists; otherwise nothing. A failed read throws. */
  async load(): Promise<Secrets> {
    const keys = await this.readIndex();
    if (keys === null) return {};
    return this.fromKeychain(keys);
  }

  /** Saves into the keychain only: no file, and no database statement. */
  async save(secrets: Secrets): Promise<void> {
    const fields = toFields(secrets);
    for (const [key, text] of fields) {
      const bytes = fieldBytes(text);
      if (bytes > KEYCHAIN_FIELD_LIMIT) {
        throw new Error(`${key} is ${bytes} bytes; the keychain holds at most ${KEYCHAIN_FIELD_LIMIT} per entry. Nothing was saved.`);
      }
    }
    const previous = (await this.readIndex()) ?? [];
    for (const [key, text] of fields) await this.keychain.write(key, text);
    for (const key of previous) {
      if (!fields.has(key)) await this.keychain.clear(key);
    }
    // The index is written last, so a failed save leaves the previous index in place.
    await this.keychain.write(INDEX_KEY, JSON.stringify({ source: "save", keys: [...fields.keys()] }));
  }

  /** The keys listed by `_index`, or `null` when there is no index. */
  private async readIndex(): Promise<string[] | null> {
    const text = await this.keychain.read(INDEX_KEY);
    if (text === null) return null;
    return (JSON.parse(text) as { keys: string[] }).keys;
  }

  /** Rebuilds the credentials from the listed fields; a listed field that is missing is skipped. */
  private async fromKeychain(keys: string[]): Promise<Secrets> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const text = await this.keychain.read(key);
      if (text === null) continue;
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
}
