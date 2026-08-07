/**
 * Session-scoped persistence for active MCP grants so they survive a page
 * reload and the browser relay can resume until the grant's own TTL expires.
 *
 * Mirrors the E2EE session-key cache: the record (grant + pairing secret +
 * settings) is AES-GCM encrypted with a non-extractable CryptoKey held in
 * IndexedDB, and the ciphertext lives in sessionStorage. A storage snapshot
 * alone cannot recover the pairing secret offline, and everything is cleared
 * when the tab closes or the user signs out (the `tt:` sessionStorage key is
 * wiped by clearLocalDeviceData, the wrap key by clearPersistedMcpSessions).
 */

import type { AiAccessSettings, AiActiveSession } from "@weaveforge/core";
import { singleFlight } from "@/lib/single-flight";

export interface PersistedMcpSession {
  session: AiActiveSession;
  secret: string;
  settings: AiAccessSettings;
}

const STORAGE_KEY = "tt:mcp:sessions-wrapped";
const WRAP_IDB_NAME = "tt-mcp-wrapkey";
const WRAP_STORE = "keys";
const WRAP_KEY_ID = "session-wrap-key";

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

export async function loadPersistedMcpSessions(): Promise<PersistedMcpSession[]> {
  if (typeof window === "undefined") return [];
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string };
    const key = await getWrapKey();
    if (!key) throw new Error("missing wrap key");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toBufferSource(base64ToBytes(iv)) },
      key,
      toBufferSource(base64ToBytes(ct)),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as PersistedMcpSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

export async function savePersistedMcpSessions(list: readonly PersistedMcpSession[]): Promise<void> {
  if (typeof window === "undefined") return;
  if (list.length === 0) {
    await clearPersistedMcpSessions();
    return;
  }
  const key = await getOrCreateWrapKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(iv) },
    key,
    new TextEncoder().encode(JSON.stringify(list)),
  );
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) }),
  );
}

export async function clearPersistedMcpSessions(): Promise<void> {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
  await deleteDatabase(WRAP_IDB_NAME);
}

function openWrapDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WRAP_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(WRAP_STORE)) req.result.createObjectStore(WRAP_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getWrapKey(): Promise<CryptoKey | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    db = await openWrapDb();
  } catch {
    return null;
  }
  try {
    return await new Promise<CryptoKey | null>((resolve, reject) => {
      const req = db.transaction(WRAP_STORE, "readonly").objectStore(WRAP_STORE).get(WRAP_KEY_ID);
      req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Two concurrent saves would otherwise each generate a key and race to store
 * it: the loser's key wins in IndexedDB and the winner's ciphertext can never
 * be decrypted again, silently dropping the session.
 */
function getOrCreateWrapKey(): Promise<CryptoKey> {
  return singleFlight("mcp:wrap-key", createWrapKeyOnce);
}

async function createWrapKeyOnce(): Promise<CryptoKey> {
  const existing = await getWrapKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const db = await openWrapDb();
  try {
    // Re-check inside the write transaction: another tab may have stored a key
    // between our read and this write, and its ciphertext would outlive ours.
    return await new Promise<CryptoKey>((resolve, reject) => {
      const tx = db.transaction(WRAP_STORE, "readwrite");
      const store = tx.objectStore(WRAP_STORE);
      const read = store.get(WRAP_KEY_ID);
      let winner: CryptoKey = key;
      read.onsuccess = () => {
        const stored = read.result as CryptoKey | undefined;
        if (stored) winner = stored;
        else store.put(key, WRAP_KEY_ID);
      };
      tx.oncomplete = () => resolve(winner);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function deleteDatabase(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
