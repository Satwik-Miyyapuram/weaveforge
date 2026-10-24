"use client";

import { useEffect, useRef } from "react";
import { normalizePasteSettings, type PasteSettings } from "@weaveforge/core";

import { readStoredJson, writeStoredJson } from "@/lib/safe-storage";

/**
 * Where the paste rules are stored.
 *
 * `localStorage`, alongside the theme and cite-format preferences, rather than
 * the settings row. Two reasons, and the first is the binding one: a paste is
 * synchronous — the caret is already moving — so the rules have to be readable
 * without awaiting anything. The second is that "how my clipboard behaves on
 * this machine" is a per-device preference, like the theme; a shared laptop and
 * a phone can reasonably want different answers.
 */
const STORAGE_KEY = "thesis.paste";

/** Fired on the window when the rules change, so open editors pick them up. */
const PASTE_SETTINGS_CHANGE_EVENT = "weaveforge:paste-settings";

export function readPasteSettings(): PasteSettings {
  // Storage disabled, or a value another version wrote: the defaults are
  // always a safe answer, so a bad record never blocks pasting.
  return normalizePasteSettings(readStoredJson<unknown>(STORAGE_KEY, undefined));
}

export function writePasteSettings(settings: PasteSettings): void {
  // In private mode the change still applies to this session through the event.
  writeStoredJson(STORAGE_KEY, normalizePasteSettings(settings));
  window.dispatchEvent(new Event(PASTE_SETTINGS_CHANGE_EVENT));
}

/** Calls `onChange` whenever the rules change, in this tab or another one. */
function watchPasteSettings(onChange: (settings: PasteSettings) => void): () => void {
  const notify = () => onChange(readPasteSettings());
  window.addEventListener(PASTE_SETTINGS_CHANGE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(PASTE_SETTINGS_CHANGE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

/**
 * A ref holding the current rules, kept up to date without rebuilding the
 * editor around it.
 *
 * The CodeMirror stack is built once per document — rebuilding it throws away
 * the undo history, and in a co-edited note it tears down the Yjs binding — so
 * the rules reach it the same way completions do: through a ref the extension
 * reads on each event.
 */
export function usePasteSettingsRef(): { current: PasteSettings } {
  const ref = useRef<PasteSettings>(readPasteSettings());
  useEffect(() => {
    ref.current = readPasteSettings();
    return watchPasteSettings((next) => {
      ref.current = next;
    });
  }, []);
  return ref;
}
