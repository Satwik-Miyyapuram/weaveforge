"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { FocusGlyph } from "./focus-glyph";
import { shortcutLabel } from "@/lib/shortcut-label";
import { IconButton } from "./button";

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
    <IconButton label="Focus" tip={`Focus (${shortcutLabel("⌘⇧F")})`} size="sm" onClick={onClick}>
      <FocusGlyph on={false} />
    </IconButton>
  );
}

/** The one control focus keeps: the corner way back. */
export function InkFocusExit({ onClick }: { onClick: () => void }) {
  return (
    <span className="focus-exit">
      <IconButton label="Exit focus" tip={`Exit focus (${shortcutLabel("⌘⇧F")})`} size="sm" onClick={onClick}>
        <FocusGlyph on />
      </IconButton>
    </span>
  );
}
