import type { SettingsSection } from "../file-tag-repo";

/** An in-memory settings file: nested keys, `undefined` deletes. */
export class MemorySettings implements SettingsSection {
  doc: Record<string, unknown> = {};

  get(key: readonly string[]): unknown {
    let cur: unknown = this.doc;
    for (const k of key) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
    return cur;
  }

  set(key: readonly string[], value: unknown): void {
    let obj = this.doc;
    for (const k of key.slice(0, -1)) obj = (obj[k] ??= {}) as Record<string, unknown>;
    const leaf = key[key.length - 1]!;
    if (value === undefined) delete obj[leaf];
    else obj[leaf] = value;
  }
}
