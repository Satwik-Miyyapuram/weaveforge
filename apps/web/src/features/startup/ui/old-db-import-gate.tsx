"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { desktop } from "@/lib/desktop/desktop-bridge";
import {
  importOldDb,
  openOldDb,
  type OldDbShell,
} from "../application/import-old-db";
import { browserUpgradeDeps, upgradeTier } from "../application/upgrade-tier";

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
      // Tier first (modes-093 section 12). A failure keeps the old flags,
      // which still work, and the next start tries again.
      await upgradeTier(browserUpgradeDeps()).catch(() => undefined);
      try {
        if (!(await shell.status())) {
          if (live) setPhase({ kind: "done" });
          return;
        }
        if (live) setPhase({ kind: "importing", table: "", index: 0, total: 0 });
        await importOldDb({
          shell,
          open: openOldDb,
          onProgress: (progress) => {
            if (live) setPhase({ kind: "importing", ...progress });
          },
        });
        if (live) setPhase({ kind: "done" });
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
    !bridge.oldDbTar ||
    !bridge.oldDbImportTable ||
    !bridge.oldDbImportFinish
  )
    return null;
  return {
    status: bridge.oldDbStatus.bind(bridge),
    tar: bridge.oldDbTar.bind(bridge),
    importTable: bridge.oldDbImportTable.bind(bridge),
    finish: bridge.oldDbImportFinish.bind(bridge),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
