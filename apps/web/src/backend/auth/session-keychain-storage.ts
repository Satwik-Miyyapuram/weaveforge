/**
 * Supabase session storage kept in the OS keychain (modes-093 section 5).
 *
 * Every storage key of one profile lives in one secret, `session:<profileId>`,
 * as a JSON map. The keychain port is injected so this module stays free of
 * Tauri; the desktop shell supplies the real port.
 */

export interface SecretPort {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** The async storage shape supabase-js accepts for `auth.storage`. */
export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function sessionSecretName(profileId: string): string {
  return `session:${profileId}`;
}

type SessionMap = Record<string, string>;

/**
 * Pending work per secret name. Every call for one profile runs after the
 * previous one, so a read-modify-write cannot overlap another and drop a key.
 */
const queues = new Map<string, Promise<void>>();

function inOrder<T>(name: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(name) ?? Promise.resolve()).then(task);
  queues.set(
    name,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** A corrupt or non-object value reads as an empty session, never a throw. */
function parseMap(raw: string | null): SessionMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SessionMap;
    }
  } catch {
    // Fall through: treated as empty.
  }
  return {};
}

export function createSessionKeychainStorage(
  port: SecretPort,
  profileId: string,
): AsyncKeyValueStorage {
  const name = sessionSecretName(profileId);
  const load = async (): Promise<SessionMap> => parseMap(await port.get(name));

  return {
    getItem(key) {
      return inOrder(name, async () => {
        const map = await load();
        const value = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
        return typeof value === "string" ? value : null;
      });
    },
    setItem(key, value) {
      return inOrder(name, async () => {
        const map = await load();
        map[key] = value;
        await port.set(name, JSON.stringify(map));
      });
    },
    removeItem(key) {
      return inOrder(name, async () => {
        const map = await load();
        delete map[key];
        if (Object.keys(map).length === 0) {
          await port.remove(name);
        } else {
          await port.set(name, JSON.stringify(map));
        }
      });
    },
  };
}
