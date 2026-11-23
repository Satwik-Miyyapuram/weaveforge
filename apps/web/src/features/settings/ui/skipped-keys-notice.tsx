"use client";

import { useEffect, useState } from "react";
import { DeviceSecretsStore } from "@/backend/device-secrets-store";

/**
 * Where the desktop and Android apps keep integration keys: the OS store each build opens
 * (`native_store` in apps/shell/src/lib.rs), never a file and never the account.
 */
export const DEVICE_KEYS_LINE =
  "Keys are kept in this device's system keychain (Windows Credential Manager, the macOS keychain, " +
  "Secret Service on Linux, or the Android Keystore). Signing in does not move them to your account.";

/** Reads which saved keys the keychain could not return. Names only; the values are never passed on. */
export type SkippedKeysLoader = () => Promise<{ skipped: string[] }>;

/** The line for keys the keychain could not read, or null when none were skipped. */
export function skippedKeysText(skipped: readonly string[]): string | null {
  const names = [...new Set(skipped)];
  if (names.length === 0) return null;
  const noun = names.length === 1 ? "saved key" : "saved keys";
  return `${names.length} ${noun} could not be read; re-enter them in Settings: ${names.join(", ")}.`;
}

/** The notice for a list of skipped key names; nothing when the list is empty. */
export function SkippedKeysNoticeView({ skipped }: { skipped: readonly string[] }) {
  const text = skippedKeysText(skipped);
  return text ? <p className="muted" role="status">{text}</p> : null;
}

/** A loader over `store` that keeps the skipped names and drops every loaded value. */
export function skippedKeysOf(store: Pick<DeviceSecretsStore, "loadWithSkipped">): SkippedKeysLoader {
  return async () => ({ skipped: (await store.loadWithSkipped()).skipped });
}

const deviceLoader: SkippedKeysLoader = () => skippedKeysOf(new DeviceSecretsStore())();

/**
 * Desktop only: names the saved keys that `DeviceSecretsStore` skipped because the keychain
 * could not read them, so the reader knows which to type again. Only the names leave the loader.
 */
export function SkippedKeysNotice({ load = deviceLoader }: { load?: SkippedKeysLoader }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    load()
      .then((r) => { if (live) setSkipped(r.skipped); })
      // A failed read is reported where the settings load; this notice stays empty.
      .catch(() => undefined);
    return () => { live = false; };
  }, [load]);
  return <SkippedKeysNoticeView skipped={skipped} />;
}
