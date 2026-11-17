"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { desktop } from "@/lib/desktop/desktop-bridge";
import {
  importOldDbOnce,
  openOldDb,
  type OldDbShell,
} from "../application/import-old-db";

type Phase =
  | { kind: "checking" }
  | { kind: "importing"; table: string; index: number; total: number }
  | { kind: "failed"; message: string }
  | { kind: "done" };

/**
 * Holds the workspace back until the 0.8 data, if there is any, is in native
 * Postgres. Nothing under it mounts first, so no screen shows an empty
 * workspace where the old data belongs. Web builds and shells without the
 * import pass straight through.
 */
export function OldDbImportGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const shell = oldDbShell();
    if (!shell) {
      setPhase({ kind: "done" });
      return;
    }
    let live = true;
    (async () => {
      try {
        if (!(await shell.status())) {
          if (live) setPhase({ kind: "done" });
          return;
        }
        if (live) setPhase({ kind: "importing", table: "", index: 0, total: 0 });
        const outcome = await importOldDbOnce({
          shell,
          open: openOldDb,
          onProgress: (progress) => {
            if (live) setPhase({ kind: "importing", ...progress });
          },
        });
        // Providers above this gate already asked who the user is, before the
        // import brought the old account in; a reload makes them ask again.
        // It runs even if the gate unmounted meanwhile: a remount would see
        // nothing left to import and show the stale user.
        if (outcome.imported) window.location.reload();
        else if (live) setPhase({ kind: "done" });
      } catch (error) {
        if (live) setPhase({ kind: "failed", message: messageOf(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  if (phase.kind === "checking") return null;
  if (phase.kind === "done") return <>{children}</>;

  return (
    <main className="app-shell" role="status" aria-live="polite">
      {phase.kind === "importing" ? (
        <p>
          Bringing over your 0.8 data…
          {phase.total > 0 ? ` (table ${phase.index} of ${phase.total})` : null}
        </p>
      ) : (
        <>
          <p>Could not bring over your 0.8 data: {phase.message}</p>
          <p>Your old data has not been changed. You can try again.</p>
          <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </>
      )}
    </main>
  );
}

/** The shell's old-data commands, or null when this build or shell has none. */
function oldDbShell(): OldDbShell | null {
  const bridge = desktop();
  if (
    !bridge ||
    !bridge.oldDbStatus ||
    !bridge.oldDbTarPart ||
    !bridge.oldDbImportTable ||
    !bridge.oldDbImportFinish
  )
    return null;
  return {
    status: bridge.oldDbStatus.bind(bridge),
    tarPart: bridge.oldDbTarPart.bind(bridge),
    importTable: bridge.oldDbImportTable.bind(bridge),
    finish: bridge.oldDbImportFinish.bind(bridge),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
