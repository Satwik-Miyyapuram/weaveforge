/** Fake keychains and helpers shared by the device-secrets keychain tests. */
import { KeychainUnavailableError, type DeviceKeychain, type DeviceSecretsStore } from "../device-secrets-store";

export const LOCKED = "The keychain is locked, so the saved credentials cannot be read. Unlock it and try again. Nothing was changed.";

/** A keychain of named entries, recording every key written. */
export function fakeKeychain(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  const writes: string[] = [];
  const keychain: DeviceKeychain = {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, text) => {
      writes.push(key);
      entries.set(key, text);
    },
    clear: async (key) => {
      entries.delete(key);
    },
  };
  return { entries, writes, keychain };
}

/** A keychain whose reads fail the way a locked keyring does. */
export const lockedKeychain: DeviceKeychain = {
  read: async () => {
    throw new Error(LOCKED);
  },
  write: async () => {
    throw new Error(LOCKED);
  },
  clear: async () => {
    throw new Error(LOCKED);
  },
};

/** A keychain on a machine with no Secret Service to store into. */
export const noKeychain: DeviceKeychain = {
  read: async () => null,
  write: async () => {
    throw new KeychainUnavailableError();
  },
  clear: async () => undefined,
};

export const indexOf = (keys: string[], source = "save") => JSON.stringify({ source, keys });

/** A flat field map for a save: top-level names the typed `Secrets` does not list (the test fixtures). */
export const flat = (fields: Record<string, string>) => fields as unknown as Parameters<DeviceSecretsStore["save"]>[0];
/** Captures console.warn while `work` runs. */
export async function warnings(work: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void seen.push(args.map(String).join(" "));
  try {
    await work();
  } finally {
    console.warn = original;
  }
  return seen;
}
