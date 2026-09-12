"use client";

/**
 * Ink notes: which engine reads the handwriting, and the one opt-in that lets
 * strokes leave the machine (§5.2, §7 step 7).
 *
 * The engine list is the selector's candidate list in the selector's order, so
 * what the panel shows is what a Recognise run will do. MyScript joins the list
 * only when a key is held here; the key lives in the per-user settings record
 * under `integrations.myscript`, next to the other third-party keys, and is
 * saved by the screen's Save button like the rest of `settings`.
 */

import { useEffect, useState } from "react";
import { MYSCRIPT_ENGINE_ID, type UserSettings } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import {
  STROKE_CTC_ENGINE_ID,
  WINDOWS_INK_ENGINE_ID,
} from "@/features/ink/application/recognisers";

/** What each engine is, in words the settings screen can show. */
const ENGINE_LABELS: Record<string, { name: string; where: string }> = {
  [WINDOWS_INK_ENGINE_ID]: {
    name: "Windows Ink",
    where: "On this machine, through the desktop app's helper.",
  },
  [STROKE_CTC_ENGINE_ID]: {
    name: "Built-in stroke model",
    where: "On this machine, in the browser. Not shipped in this build.",
  },
  [MYSCRIPT_ENGINE_ID]: {
    name: "MyScript iink",
    where: "MyScript's servers; strokes are sent over the network.",
  },
};

export interface InkSettingsPanelProps {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
}

interface EngineRow {
  id: string;
  available: boolean;
}

/** The key the panel edits; `""` when there is none. */
export function myScriptKeyOf(settings: UserSettings): string {
  return settings.integrations?.myscript?.applicationKey ?? "";
}

/** `settings` with the MyScript key set, or removed when blank. */
export function withMyScriptKey(settings: UserSettings, key: string): UserSettings {
  const trimmed = key.trim();
  const integrations = { ...(settings.integrations ?? {}) };
  const myscript = { ...(integrations.myscript ?? {}) };
  if (trimmed) myscript.applicationKey = trimmed;
  else delete myscript.applicationKey;
  if (Object.keys(myscript).length) integrations.myscript = myscript;
  else delete integrations.myscript;
  const next: UserSettings = { ...settings, integrations };
  if (!Object.keys(integrations).length) delete next.integrations;
  return next;
}

export function InkSettingsPanel({ settings, onChange }: InkSettingsPanelProps) {
  const key = myScriptKeyOf(settings);
  const [engines, setEngines] = useState<EngineRow[] | null>(null);

  // Probed once: the candidate list comes from the saved settings, so a key
  // typed here joins it after Save — the MyScript row says so in the meantime.
  useEffect(() => {
    let live = true;
    void getContainer()
      .ink.candidates()
      .then(async (candidates) => {
        const rows = await Promise.all(
          candidates.map(async (engine) => {
            let available = false;
            try {
              available = await engine.available();
            } catch {
              available = false;
            }
            return { id: engine.id, available };
          }),
        );
        if (live) setEngines(rows);
      });
    return () => {
      live = false;
    };
  }, []);

  const local = engines?.filter((engine) => engine.id !== MYSCRIPT_ENGINE_ID) ?? null;
  const savedMyScript = engines?.find((engine) => engine.id === MYSCRIPT_ENGINE_ID) ?? null;
  const chosen = engines?.find((engine) => engine.available)?.id ?? null;
  const myScriptStatus = savedMyScript
    ? key
      ? savedMyScript.id === chosen
        ? "in use"
        : savedMyScript.available
          ? "available"
          : "key set, but unreachable"
      : "on until you save"
    : key
      ? "on once you save"
      : "off";

  return (
    <div id="settings-ink" className="card add-form settings-anchor" role="tabpanel" aria-labelledby="settings-tab-ink">
      <h3 className="settings-group">Ink notes</h3>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        Handwriting is recognised by the first engine below that is available here. Nothing
        written in an ink note leaves this machine unless a MyScript key is set.
      </p>

      <ul className="settings-engine-list" aria-label="Recognition engines">
        {local === null ? (
          <li className="muted">Checking engines…</li>
        ) : (
          local.map((engine) => {
            const label = ENGINE_LABELS[engine.id] ?? { name: engine.id, where: "" };
            return (
              <li key={engine.id}>
                <strong>{label.name}</strong>{" "}
                <span className="muted">
                  — {engine.available ? (engine.id === chosen ? "in use" : "available") : "unavailable"}
                  {label.where ? `. ${label.where}` : ""}
                </span>
              </li>
            );
          })
        )}
        {engines !== null ? (
          <li>
            <strong>{ENGINE_LABELS[MYSCRIPT_ENGINE_ID]!.name}</strong>{" "}
            <span className="muted">
              — {myScriptStatus}. {ENGINE_LABELS[MYSCRIPT_ENGINE_ID]!.where}
            </span>
          </li>
        ) : null}
      </ul>
      {engines !== null && chosen === null ? (
        <p className="muted">
          No engine can run here, so Recognise is disabled. Use the desktop app on Windows, or
          add a MyScript key.
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="ink-myscript-key">MyScript application key</label>
        <input
          id="ink-myscript-key"
          className="themed-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          placeholder="Leave empty to keep recognition on this machine"
          onChange={(event) => onChange(withMyScriptKey(settings, event.target.value))}
        />
        <p className="muted jump-to-meta">
          With a key, pages you recognise are sent to MyScript&apos;s cloud. Clear it to go
          back to the local engines. Saved with the rest of your settings.
        </p>
      </div>
    </div>
  );
}
