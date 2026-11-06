"use client";

import { useEffect } from "react";

import { onOutsideEditsTakenIn } from "../application/workspace-folder";
import { showToast } from "@/lib/toast";

/** The note for edits taken in from the folder with no click. */
export function folderChangedMessage(count: number): string {
  return `Folder changed: ${count} file${count === 1 ? "" : "s"} reloaded.`;
}

/** Say each auto-apply as a toast; answers with the way to stop. */
export function noteFolderChanges(
  listen: (listener: (count: number) => void) => () => void = onOutsideEditsTakenIn,
  show: (message: string) => void = showToast,
): () => void {
  return listen((count) => show(folderChangedMessage(count)));
}

/**
 * Edits made in the connected folder are taken in by themselves; this says so on
 * any screen, not only in Settings, so nothing changes unseen. Paints nothing.
 */
export function FolderChangeNote() {
  useEffect(() => noteFolderChanges(), []);
  return null;
}
