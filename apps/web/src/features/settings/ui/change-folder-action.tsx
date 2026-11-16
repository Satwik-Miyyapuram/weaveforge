"use client";

import { Button } from "@/components/button";
import { chooseDesktopFolder } from "@/features/workspace/application/workspace-folder";

/** The note that sits beside Change folder: what moves, and what does not go away. */
export const CHANGE_FOLDER_NOTE = "Moves where your files are mirrored; nothing is deleted.";

/**
 * The folder move as one job for the panel's `run`: open the folder dialog, and
 * if a folder was connected hand its warnings on. A cancelled dialog hands nothing.
 */
export function changeFolderWork(onChanged: (warnings: readonly string[]) => void): () => Promise<void> {
  return async () => {
    const picked = await chooseDesktopFolder({});
    if (picked) onChanged(picked.warnings);
  };
}

/**
 * Settings → Workspace, desktop only: opens the folder dialog directly. No extra
 * confirm; the note says what the move does. It shares the panel's `busy` and
 * `run`, so Disconnect and Write now stay disabled while the picker is open.
 */
export function ChangeFolderAction({
  busy,
  run,
  onChanged,
}: {
  busy: string | null;
  run: (label: string, work: () => Promise<void>) => Promise<void> | void;
  onChanged: (warnings: readonly string[]) => void;
}) {
  return (
    <div>
      <p className="muted jump-to-meta">{CHANGE_FOLDER_NOTE}</p>
      <Button disabled={busy !== null} onClick={() => void run("change", changeFolderWork(onChanged))}>
        {busy === "change" ? "Choosing…" : "Change folder…"}
      </Button>
    </div>
  );
}
