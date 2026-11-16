"use client";

import { Modal } from "@/components/modal";
import { readyCore } from "@/lib/rust-core";
import { type WorkspaceCommand } from "../application/parts";
import { ShortcutGrid } from "./pane-view";

/**
 * Every command, with `⌘2`–`⌘8` left out: `⌘1` and `⌘9` show the pattern.
 * A function, not a constant: the chords come from the loaded core, which a
 * module-level read would run before.
 */
export function cheatsheetCommands(): readonly WorkspaceCommand[] {
  return (Object.keys(readyCore().shortcutTable()) as WorkspaceCommand[]).filter(
    (command) => !/^tab-[2-8]$/.test(command),
  );
}

/** The `⌘/` sheet: what every workspace shortcut does. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} className="shortcuts-dialog">
      <ShortcutGrid commands={cheatsheetCommands()} />
    </Modal>
  );
}
