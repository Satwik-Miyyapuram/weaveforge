import type { IWorkspaceFs } from "@weaveforge/core";
import type { SettingsSection } from "./file-tag-repo";

/**
 * Credential field names: the `Secrets` fields (features/settings/infrastructure/parts.ts), plus the names an
 * integration uses for its credential inside `integrations`. A field with one of these names is a secret.
 */
export const SECRET_FIELDS = ["zoteroApiKey", "semanticScholarKey", "integrations", "apiKey", "pat", "token", "secret", "password", "credential"] as const;

/**
 * Words that mark a credential anywhere in a name (substring match, case-insensitive).
 * Limits: it is a name check, not a value check. A credential stored under a neutral name
 * (`pins.x`) passes; values are checked only for the key names in `isSecretValueKey`.
 * `auth(?!or)` keeps `author`, `authors` and `authorName` (paper metadata) legal.
 */
const SECRET_WORD = /secret|token|password|credential|bearer|cookie|refresh|session|auth(?!or)|api.?key|private.?key/i;

/** Path segments are settings names or user ids (paperId, annotationKey). Only fixed names are checked here. */
function isSecretPathSegment(segment: string): boolean {
  return (SECRET_FIELDS as readonly string[]).includes(segment) || SECRET_WORD.test(segment);
}

/** Object keys in a value are checked strictly, including any name ending in `key`. */
export function isSecretValueKey(name: string): boolean {
  return (SECRET_FIELDS as readonly string[]).includes(name) || SECRET_WORD.test(name) || /key$/i.test(name);
}

function hasSecretInValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = hasSecretInValue(item);
      if (found) return found;
    }
    return null;
  }
  if (isObject(value)) {
    for (const [name, child] of Object.entries(value)) {
      if (isSecretValueKey(name)) return name;
      const found = hasSecretInValue(child);
      if (found) return found;
    }
  }
  return null;
}

/** Throws when a write would put a credential in settings.json. Callers check every planned write before the first one. */
export function assertNoSecret(key: readonly string[], value: unknown): void {
  if (key.some(isSecretPathSegment) || hasSecretInValue(value) !== null) {
    throw new Error(`Refusing to store a secret in settings.json (key "${key.join(".")}").`);
  }
}

export interface FileSettingsSection extends SettingsSection {
  /** Resolves once every `set` so far is on disk. Rejects if the write failed. */
  flush(): Promise<void>;
  /** Resolves once the write is on disk; rejects if it failed. */
  set(key: readonly string[], value: unknown): Promise<void>;
  /** Set when a corrupt settings.json was moved aside on open. */
  notice?: string;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseObject(text: string): Json | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads `<root>/.weaveforge/settings.json` once, keeps it in memory, and writes it back on every `set`.
 * Each write goes to `settings.json.part` first and is renamed over the real file, so a crash mid-write
 * keeps the old file. The rename is the commit point, so a leftover `.part` on open was never committed and is
 * discarded. A corrupt settings.json is moved aside as `settings.json.bad-<ts>` and the section starts empty.
 */
export async function openFileSettingsSection(fs: IWorkspaceFs, root: string): Promise<FileSettingsSection> {
  const dir = root === "" ? ".weaveforge" : `${root}/.weaveforge`;
  const path = `${dir}/settings.json`;
  const partPath = `${path}.part`;
  let notice: string | undefined;

  if (await fs.stat(partPath)) await fs.remove(partPath);

  let data: Json = {};
  if (await fs.stat(path)) {
    const parsed = parseObject(await fs.readText(path));
    if (parsed) {
      data = parsed;
    } else {
      notice = `Unreadable settings moved aside as ${await moveAside(fs, dir, path)} (starting empty)`;
    }
  }

  const readRaw = async (): Promise<string | null> => ((await fs.stat(path)) ? fs.readText(path) : null);

  /** What a write applies to: the file as it is on disk, or the session's values when the file is missing or corrupt. */
  const load = async (): Promise<{ raw: string | null; doc: Json }> => {
    const raw = await readRaw();
    const parsed = raw === null ? null : parseObject(raw);
    if (parsed) return { raw, doc: parsed };
    if (raw !== null) notice = `Unreadable settings moved aside as ${await moveAside(fs, dir, path)} (kept this session's values)`;
    return { raw: raw === null ? null : await readRaw(), doc: structuredClone(data) };
  };

  /**
   * Re-reads and re-applies, up to MAX_WRITE_TRIES, when another writer changed settings.json between this
   * write's read and its rename. The rename is then done only on a file that was unchanged since the read.
   */
  const commit = async (apply: (doc: Json) => void): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_WRITE_TRIES; attempt++) {
      const { raw, doc } = await load();
      apply(doc);
      await fs.mkdirp(dir);
      let committedNow = false;
      try {
        await fs.writeFile(partPath, `${JSON.stringify(doc, null, 2)}\n`);
        if ((await readRaw()) !== raw) continue;
        await fs.rename(partPath, path);
        committedNow = true;
        return;
      } finally {
        // Anything not renamed into place is not a commit: drop it. Never mask the error that is in flight.
        if (!committedNow) await discardPart(fs, partPath);
      }
    }
    throw new Error(`settings.json was changed by another writer on every try (gave up after ${MAX_WRITE_TRIES})`);
  };

  /**
   * One write at a time per file, across every handle in this process. The in-memory `data` is already
   * updated by `set`; this only puts the change on disk. It is not replaced by what was read, so a later
   * queued set is never lost.
   */
  const persist = (keys: readonly string[], apply: (doc: Json) => void): Promise<void> => {
    const prev = writeQueues.get(path) ?? Promise.resolve();
    const next = prev.then(() => commit(apply)).catch((error: unknown) => {
      // Key names and the error name only: a value may be a credential or a private note.
      console.error("settings.json save failed", {
        keys: keys.join("."),
        error: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    });
    writeQueues.set(path, next.catch(() => undefined));
    return next;
  };

  /** The last value of each key (by its joined path) known to be on disk, and the latest set number per key. */
  const committed = new Map<string, unknown>();
  const latestSet = new Map<string, number>();
  let setCount = 0;

  return {
    get(key) {
      let node: unknown = data;
      for (const part of key) {
        if (!isObject(node)) return undefined;
        node = node[part];
      }
      return structuredClone(node);
    },
    set(key, value) {
      assertNoSecret(key, value);
      const id = key.join("\u0000");
      if (!committed.has(id)) committed.set(id, readAt(data, key));
      const mine = ++setCount;
      latestSet.set(id, mine);
      setAt(data, key, structuredClone(value));
      return persist(key, (doc) => setAt(doc, key, structuredClone(value))).then(
        () => {
          committed.set(id, structuredClone(value));
        },
        (error: unknown) => {
          // The write did not reach disk. Roll back only when no later set on this key is queued:
          // a later set's value is already in memory and will be written on its own.
          if (latestSet.get(id) === mine) setAt(data, key, committed.get(id));
          throw error;
        },
      );
    },
    flush() {
      return persist([], () => undefined);
    },
    notice,
  };
}

/** Tries per write before giving up when another writer keeps changing settings.json. */
const MAX_WRITE_TRIES = 3;

/** Removes an uncommitted `.part`, if any. A failure here is ignored so the write's own error is what the caller sees. */
async function discardPart(fs: IWorkspaceFs, partPath: string): Promise<void> {
  try {
    if (await fs.stat(partPath)) await fs.remove(partPath);
  } catch {
    // Leftover .part is discarded on the next open.
  }
}

/** Renames a corrupt settings.json to `settings.json.bad-<ts>` and returns the new name. */
async function moveAside(fs: IWorkspaceFs, dir: string, path: string): Promise<string> {
  const badName = `settings.json.bad-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.rename(path, `${dir}/${badName}`);
  return badName;
}

function readAt(root: Json, key: readonly string[]): unknown {
  let node: unknown = root;
  for (const part of key) {
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return structuredClone(node);
}

/** The write chain per settings.json path, shared by every section opened on that path in this process. */
const writeQueues = new Map<string, Promise<void>>();

function setAt(root: Json, key: readonly string[], value: unknown): void {
  let node: Json = root;
  for (const part of key.slice(0, -1)) {
    if (!isObject(node[part])) node[part] = {};
    node = node[part] as Json;
  }
  const last = key[key.length - 1];
  if (last !== undefined) node[last] = value;
}
