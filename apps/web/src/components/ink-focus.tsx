"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { FocusGlyph } from "./focus-glyph";

/**
 * Focus for ink on a record page, the Editor's way (`⌘⇧F`): the sheet
 * full-bleed and the pen palette floating over it, nothing else. Only while
 * Ink is on — leaving Ink leaves focus too. Per visit, never persisted.
 */
export function useInkFocus(inkOn: boolean) {
  const [wanted, setWanted] = useState(false);
  const focus = wanted && inkOn;
  const toggle = useCallback(() => setWanted((current) => !current), []);

  useEffect(() => {
    if (!inkOn) setWanted(false);
  }, [inkOn]);

  useEffect(() => {
    if (!inkOn) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setWanted((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inkOn]);

  // The app's title bar and the desktop shell's own chrome go with it.
  useEffect(() => {
    if (!focus) return;
    const root = document.documentElement;
    root.dataset.inkFocus = "";
    desktop()?.setWindowFocus?.(true);
    return () => {
      delete root.dataset.inkFocus;
      desktop()?.setWindowFocus?.(false);
    };
  }, [focus]);

  return { focus, toggle };
}

/** The way into focus, beside the Edit / Read / Ink switch. */
export function InkFocusButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="record-focus-btn"
      title="Focus (⌘⇧F)"
      aria-label="Focus"
      onClick={onClick}
    >
      <FocusGlyph on={false} />
    </button>
  );
}

/** The one control focus keeps: the corner way back. */
export function InkFocusExit({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="focus-exit"
      title="Exit focus (⌘⇧F)"
      aria-label="Exit focus"
      onClick={onClick}
    >
      <FocusGlyph on />
    </button>
  );
}
