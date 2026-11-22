import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { FileSink } from "../domain/ports";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

export const SETTINGS_PATH = ".weaveforge/settings.json";

/**
 * Reads `.weaveforge/settings.json` fresh. Only a missing file is empty: a read or parse failure must
 * surface, or the write that follows would wipe every other setting in the file.
 */
export async function loadSettingsDoc(sink: FileSink, label: string): Promise<Record<string, unknown>> {
  return parseDoc(await readRaw(sinkAsWorkspaceFs(sink)), label);
}

const SETTINGS_ATTEMPTS = 3;

/**
 * Reads, changes and saves settings.json. `mutate` runs on a fresh read every attempt, so keys another
 * writer saved meanwhile are kept. Before the rename the file is read again: if its bytes changed since
 * the read, the change is dropped and retried. After SETTINGS_ATTEMPTS tries it throws a fixed code.
 * Write-then-rename, so a crash never leaves a half-written settings.json.
 */
export async function updateSettingsDoc(
  sink: FileSink,
  label: string,
  mutate: (doc: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  const fs = sinkAsWorkspaceFs(sink);
  const part = `${SETTINGS_PATH}.part`;
  for (let attempt = 1; attempt <= SETTINGS_ATTEMPTS; attempt++) {
    const before = await readRaw(fs);
    const doc = parseDoc(before, label);
    await mutate(doc);
    try {
      await sink.write(part, JSON.stringify(doc, null, 2));
      if ((await readRaw(fs)) !== before) {
        await sink.remove(part).catch(() => undefined);
        continue;
      }
      await sink.rename(part, SETTINGS_PATH);
      return;
    } catch (err) {
      // Only the .part is removed: settings.json itself was never touched.
      await sink.remove(part).catch(() => undefined);
      throw err;
    }
  }
  throw Object.assign(new Error("settings.json changed during the save"), { code: "settings-changed" });
}

/** settings.json's text, or null when the file is absent. */
async function readRaw(fs: ReturnType<typeof sinkAsWorkspaceFs>): Promise<string | null> {
  return (await fs.stat(SETTINGS_PATH)) ? fs.readText(SETTINGS_PATH) : null;
}

function parseDoc(raw: string | null, label: string): Record<string, unknown> {
  if (raw === null) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}: ${SETTINGS_PATH} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Sync get/set over a plain settings object, the shape the File repos expect. */
export function settingsSection(root: Record<string, unknown>): SettingsSection {
  return {
    get(key) {
      let node: unknown = root;
      for (const k of key) {
        if (!node || typeof node !== "object") return undefined;
        node = (node as Record<string, unknown>)[k];
      }
      return node;
    },
    set(key, value) {
      let node = root;
      for (const k of key.slice(0, -1)) {
        if (!node[k] || typeof node[k] !== "object") node[k] = {};
        node = node[k] as Record<string, unknown>;
      }
      const last = key[key.length - 1];
      if (last === undefined) return;
      if (value === undefined) delete node[last];
      else node[last] = value;
    },
  };
}
