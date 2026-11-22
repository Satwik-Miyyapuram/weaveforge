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
function isSecretValueKey(name: string): boolean {
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
      const badName = `settings.json.bad-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await fs.rename(path, `${dir}/${badName}`);
      notice = `Unreadable settings moved aside as ${badName} (starting empty)`;
    }
  }

  /**
   * One write at a time per file, across every handle in this process. Each write re-reads the file,
   * applies its own change to what is on disk, and writes it back, so a write never drops another's key.
   */
  const persist = (keys: readonly string[], apply: (doc: Json) => void): Promise<void> => {
    const prev = writeQueues.get(path) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const doc = await readOnDisk();
        apply(doc);
        await fs.mkdirp(dir);
        await fs.writeFile(partPath, `${JSON.stringify(doc, null, 2)}\n`);
        await fs.rename(partPath, path);
        data = doc;
      })
      .catch((error: unknown) => {
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

  const readOnDisk = async (): Promise<Json> => {
    if (!(await fs.stat(path))) return {};
    return parseObject(await fs.readText(path)) ?? data;
  };

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
      if (key.some(isSecretPathSegment) || hasSecretInValue(value) !== null) {
        throw new Error(`Refusing to store a secret in settings.json (key "${key.join(".")}").`);
      }
      setAt(data, key, structuredClone(value));
      return persist(key, (doc) => setAt(doc, key, structuredClone(value)));
    },
    flush() {
      return persist([], () => undefined);
    },
    notice,
  };
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
