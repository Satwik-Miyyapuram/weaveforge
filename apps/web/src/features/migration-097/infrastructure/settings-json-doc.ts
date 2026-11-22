import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { FileSink } from "../domain/ports";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

export const SETTINGS_PATH = ".weaveforge/settings.json";

/**
 * Reads `.weaveforge/settings.json` fresh. Only a missing file is empty: a read or parse failure must
 * surface, or the write that follows would wipe every other setting in the file.
 */
export async function loadSettingsDoc(sink: FileSink, label: string): Promise<Record<string, unknown>> {
  const fs = sinkAsWorkspaceFs(sink);
  if (!(await fs.stat(SETTINGS_PATH))) return {};
  const parsed: unknown = JSON.parse(await fs.readText(SETTINGS_PATH));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}: ${SETTINGS_PATH} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Write-then-rename, so a crash never leaves a half-written settings.json. */
export async function saveSettingsDoc(sink: FileSink, doc: Record<string, unknown>): Promise<void> {
  const part = `${SETTINGS_PATH}.part`;
  try {
    await sink.write(part, JSON.stringify(doc, null, 2));
    await sink.rename(part, SETTINGS_PATH);
  } catch (err) {
    // Only the .part is removed: settings.json itself was never touched.
    await sink.remove(part).catch(() => undefined);
    throw err;
  }
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
