/**
 * The workspace settings file `.weaveforge/settings.json` holds per-workspace UI prefs.
 * It is on the git sync allowlist (crates/wf-core/src/sync/git_policy.rs) so it travels
 * with the workspace. Schema `{ "version": 1, ...sections }`. Read on folder connect,
 * external edits re-read, writes debounced. A damaged or newer file is never written.
 */
import type { IWorkspaceFs } from "@weaveforge/core";

export const SETTINGS_PATH = ".weaveforge/settings.json";
export const SETTINGS_VERSION = 1;
export const SETTINGS_WRITE_DELAY_MS = 500;
/** The longest wait between retries of a refused save. */
const SETTINGS_RETRY_MAX_MS = 60_000;
export type SettingsKey = readonly string[];
export type SettingsDoc = Record<string, unknown>;
export type SettingsState = "missing" | "ready" | "locked";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseSettings(
  text: string,
): { ok: true; doc: SettingsDoc } | { ok: false; reason: "corrupt" | "newer" } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!isPlainObject(raw)) return { ok: false, reason: "corrupt" };
  const version = raw.version;
  if (version === undefined) return { ok: true, doc: raw };
  if (typeof version !== "number" || !Number.isInteger(version)) return { ok: false, reason: "corrupt" };
  if (version > SETTINGS_VERSION) return { ok: false, reason: "newer" };
  return { ok: true, doc: raw };
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

export function renderSettings(doc: SettingsDoc): string {
  const sorted = sortDeep({ ...doc, version: SETTINGS_VERSION });
  return JSON.stringify(sorted, null, 2) + "\n";
}

export interface SettingsDeps {
  fs: () => IWorkspaceFs | null;
  warn: (message: string) => void;
  delayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface PendingSet {
  key: SettingsKey;
  value: unknown;
}

/** Writes `value` at `key`, creating intermediate objects; `undefined` deletes the leaf. */
function putAt(doc: SettingsDoc, key: SettingsKey, value: unknown): void {
  let obj: Record<string, unknown> = doc;
  for (const seg of key.slice(0, -1)) {
    if (!isPlainObject(obj[seg])) obj[seg] = {};
    obj = obj[seg] as Record<string, unknown>;
  }
  const leaf = key[key.length - 1];
  if (leaf === undefined) return;
  if (value === undefined) delete obj[leaf];
  else obj[leaf] = value;
}

export class WorkspaceSettingsFile {
  private doc: SettingsDoc = {};
  private lastText: string | null = null;
  private stateValue: SettingsState = "missing";
  private pending = new Map<string, PendingSet>();
  private generation = 0;
  private timer: unknown = null;
  private failedSaves = 0;
  private writing: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private readonly deps: SettingsDeps;
  private readonly delayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(deps: SettingsDeps) {
    this.deps = deps;
    this.delayMs = deps.delayMs ?? SETTINGS_WRITE_DELAY_MS;
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get(key: SettingsKey): unknown {
    let cur: unknown = this.doc;
    for (const seg of key) {
      if (!isPlainObject(cur)) return undefined;
      cur = cur[seg];
    }
    return cur;
  }

  set(key: SettingsKey, value: unknown): void {
    if (JSON.stringify(this.get(key)) === JSON.stringify(value)) return;
    putAt(this.doc, key, value);
    this.pending.set(key.join("\u0000"), { key, value });
    this.generation += 1;
    this.notify();
    this.scheduleWrite();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async load(): Promise<void> {
    const fs = this.deps.fs();
    if (!fs) return;
    const run = this.writing.then(() => this.reload(fs));
    this.writing = run.catch(() => undefined);
    await run;
  }

  async flush(): Promise<void> {
    this.clearTimer();
    this.writing = this.writing.then(() => this.write());
    await this.writing;
  }

  state(): SettingsState {
    return this.stateValue;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }

  private scheduleWrite(): void {
    if (this.stateValue === "locked" || !this.deps.fs()) return;
    this.clearTimer();
    this.timer = this.schedule(() => void this.flush(), this.delayMs);
  }

  private async readDisk(fs: IWorkspaceFs): Promise<string | null> {
    return (await fs.stat(SETTINGS_PATH)) ? fs.readText(SETTINGS_PATH) : null;
  }

  private async reload(fs: IWorkspaceFs): Promise<void> {
    const text = await this.readDisk(fs);
    if (text !== null && text === this.lastText) return;
    this.adopt(text);
  }

  private adopt(text: string | null): void {
    let base: SettingsDoc = {};
    if (text === null) {
      this.stateValue = "missing";
    } else {
      const parsed = parseSettings(text);
      if (parsed.ok) {
        this.stateValue = "ready";
        base = parsed.doc;
      } else {
        this.stateValue = "locked";
        const why = parsed.reason === "newer" ? "from a newer WeaveForge" : "damaged";
        this.deps.warn(`${SETTINGS_PATH} is ${why}; using defaults and leaving the file as it is.`);
      }
    }
    this.lastText = text;
    for (const p of this.pending.values()) putAt(base, p.key, p.value);
    this.doc = base;
    this.notify();
    if (this.pending.size > 0 && this.stateValue !== "locked") this.scheduleWrite();
  }

  private async checkedFallback(fs: IWorkspaceFs, text: string): Promise<boolean> {
    // Adapter without writeTextIf: compare against the last read text, then plain write.
    const current = await this.readDisk(fs);
    if (current !== this.lastText) return false;
    await fs.writeFile(SETTINGS_PATH, text);
    return true;
  }

  private async write(): Promise<void> {
    const fs = this.deps.fs();
    if (!fs || this.pending.size === 0 || this.stateValue === "locked") return;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const gen = this.generation;
        const text = renderSettings(this.doc);
        if (this.lastText === null) await fs.mkdirp(".weaveforge");
        const ok = fs.writeTextIf
          ? await fs.writeTextIf(SETTINGS_PATH, text, this.lastText)
          : await this.checkedFallback(fs, text);
        if (ok) {
          this.lastText = text;
          this.stateValue = "ready";
          this.failedSaves = 0;
          if (this.generation === gen) this.pending.clear();
          else this.scheduleWrite();
          return;
        }
        this.adopt(await this.readDisk(fs));
        // adopt() may lock the file; read it through state() so TS does not keep the narrowing.
        if (this.state() === "locked") return;
      }
      this.deps.warn(`${SETTINGS_PATH} kept changing; settings will be saved on the next change.`);
      this.retryLater();
    } catch (err) {
      this.deps.warn(`settings not saved: ${err instanceof Error ? err.message : String(err)}`);
      this.retryLater();
    }
  }

  /** Keeps unsaved edits alive: retries after a delay that doubles per failed save, capped. */
  private retryLater(): void {
    if (this.pending.size === 0 || this.stateValue === "locked" || !this.deps.fs()) return;
    const ms = Math.min(this.delayMs * 2 ** this.failedSaves, SETTINGS_RETRY_MAX_MS);
    this.failedSaves++;
    this.clearTimer();
    this.timer = this.schedule(() => void this.flush(), ms);
  }
}
