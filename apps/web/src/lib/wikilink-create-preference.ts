"use client";

import { useEffect, useRef, useState } from "react";

/**
 * What happens when a `[[link]]` names a note that does not exist.
 *
 * `create` — the default — makes the note: the completion list offers a
 * "Create note" row for an unknown title, and clicking an unresolved link in
 * Read mode creates it and opens it. `never` leaves the link dangling, for a
 * person who uses links as placeholders and does not want a note per typo.
 *
 * Stored in `localStorage` beside the paste and cite-format preferences, and
 * for the same reason: it is read inside a completion source, synchronously.
 */
export type WikilinkCreateMode = "create" | "never";

export const WIKILINK_CREATE_MODES: readonly WikilinkCreateMode[] = ["create", "never"];

export const WIKILINK_CREATE_LABELS: Record<WikilinkCreateMode, string> = {
  create: "Create the note",
  never: "Leave the link unresolved",
};

const STORAGE_KEY = "thesis.wikilinkCreate";
const CHANGE_EVENT = "weaveforge:wikilink-create";

export function parseWikilinkCreateMode(raw: unknown): WikilinkCreateMode {
  return raw === "never" ? "never" : "create";
}

export function readWikilinkCreateMode(): WikilinkCreateMode {
  if (typeof localStorage === "undefined") return "create";
  try {
    return parseWikilinkCreateMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "create";
  }
}

export function writeWikilinkCreateMode(mode: WikilinkCreateMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode: the change still applies to this session through the event.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The current mode in a ref, so an open editor follows a change in settings. */
export function useWikilinkCreateModeRef(): { current: WikilinkCreateMode } {
  const ref = useRef<WikilinkCreateMode>(readWikilinkCreateMode());
  useEffect(() => {
    ref.current = readWikilinkCreateMode();
    const notify = () => {
      ref.current = readWikilinkCreateMode();
    };
    window.addEventListener(CHANGE_EVENT, notify);
    window.addEventListener("storage", notify);
    return () => {
      window.removeEventListener(CHANGE_EVENT, notify);
      window.removeEventListener("storage", notify);
    };
  }, []);
  return ref;
}

/**
 * The same preference as state, for a screen that decides what to *render* by
 * it — whether to offer creation at all — rather than reading it per keystroke.
 */
export function useWikilinkCreateMode(): WikilinkCreateMode {
  const [mode, setMode] = useState<WikilinkCreateMode>("create");
  useEffect(() => {
    const notify = () => setMode(readWikilinkCreateMode());
    notify();
    window.addEventListener(CHANGE_EVENT, notify);
    window.addEventListener("storage", notify);
    return () => {
      window.removeEventListener(CHANGE_EVENT, notify);
      window.removeEventListener("storage", notify);
    };
  }, []);
  return mode;
}
