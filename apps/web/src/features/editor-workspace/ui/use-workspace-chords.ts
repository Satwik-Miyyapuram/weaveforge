"use client";

import { useEffect, useRef, type RefObject } from "react";

import { readyCore } from "@/lib/rust-core";
import { requestShortcuts } from "@/lib/parts-2";
import type { PaneLayout } from "@weaveforge/wasm";
import { commandForChord, isTypingTarget } from "../application/parts";

export interface WorkspaceChordActions {
  quickOpen: () => void;
  duplicate: () => void;
  rename: () => void;
  reopenTab: () => void;
  toggleExplorer: () => void;
  toggleFocus: () => void;
  newNote: () => void;
  apply: (next: PaneLayout) => void;
}

/** The workspace's keyboard chords, while its screen is the one on show. */
export function useWorkspaceChords(
  onScreen: boolean,
  layoutRef: RefObject<PaneLayout>,
  actions: WorkspaceChordActions,
): void {
  const run = useRef(actions);
  run.current = actions;
  // On the window, not the shell: CodeMirror stops propagation of many keys,
  // and a shortcut must still work with focus inside it.
  useEffect(() => {
    // Hidden behind another screen (`workspace-host.tsx`): its chords are not ours.
    if (!onScreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Only a chord this screen acts on is claimed: a ⌘-number with no tab
      // behind it falls through to the browser, which switches its own tabs.
      const command = commandForChord(event, readyCore().focusedTabCount(layoutRef.current));
      if (!command) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      // A key the document already handled (`⌘/` comment, `⌘B` bold, `⌘\`
      // clear) is the document's; elsewhere the workspace meaning applies.
      if (event.defaultPrevented) return;
      // The palette and the app sidebar own these and listen for them unhandled.
      if (command === "command-palette" || command === "workspace-search" || command === "toggle-sidebar") return;
      event.preventDefault();

      if (command === "quick-open") return run.current.quickOpen();
      if (command === "duplicate-note") return run.current.duplicate();
      if (command === "rename-doc") return run.current.rename();
      if (command === "show-shortcuts") return requestShortcuts("toggle");
      if (command === "reopen-tab") return run.current.reopenTab();
      if (command === "toggle-explorer") return run.current.toggleExplorer();
      if (command === "toggle-focus") return run.current.toggleFocus();
      if (command === "new-note") return run.current.newNote();

      // Outside a state updater, so `apply`'s storage write runs once per chord.
      const next = readyCore().layoutForCommand(layoutRef.current, command);
      if (next !== layoutRef.current) run.current.apply(next);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onScreen, layoutRef]);
}
