"use client";

import { Modal } from "@/components/modal";
import { shortcutTable, type WorkspaceCommand } from "../application/keybindings";
import { ShortcutGrid } from "./pane-view";

/** Every command, with `⌘2`–`⌘8` left out: `⌘1` and `⌘9` show the pattern. */
export const CHEATSHEET_COMMANDS: readonly WorkspaceCommand[] = (Object.keys(shortcutTable()) as WorkspaceCommand[]).filter(
  (command) => !/^tab-[2-8]$/.test(command),
);

/** The `⌘/` sheet: what every workspace shortcut does. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} className="shortcuts-dialog">
      <ShortcutGrid commands={CHEATSHEET_COMMANDS} />
    </Modal>
  );
}
