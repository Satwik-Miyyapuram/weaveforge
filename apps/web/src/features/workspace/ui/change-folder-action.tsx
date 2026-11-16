"use client";

import { useState } from "react";

import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import { chooseDesktopFolder } from "../application/workspace-folder";

/** The note that sits beside Change folder: what moves, and what does not go away. */
export const CHANGE_FOLDER_NOTE = "Moves where your files are mirrored; nothing is deleted.";

/**
 * Settings → Workspace, desktop only: opens the folder dialog directly. No extra
 * confirm; the note says what the move does. `onChanged` runs once a folder is
 * connected, so the panel can show the new one.
 */
export function ChangeFolderAction({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <p className="muted jump-to-meta">{CHANGE_FOLDER_NOTE}</p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          chooseDesktopFolder({})
            .then((picked) => {
              if (picked) onChanged();
            })
            .catch((err: unknown) => setError(formatError(err)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Choosing…" : "Change folder…"}
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}
