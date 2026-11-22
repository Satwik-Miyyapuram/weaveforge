"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/button";
import { wiringNeedsReload, type WiringKey } from "@/container/wiring-key";
import { desktop } from "./desktop-bridge";
import { shouldShowFinishRemoving, shouldShowRetry, shouldShowUpgrade } from "./migrate-097-gate-decision";
import { migrate097Status, type Migrate097Resolved } from "./migrate-097";
import { Migrate097Upgrade } from "./migrate-097-upgrade";

const BANNER_TEXT: Record<"unavailable" | "removing-other" | "incomplete", string> = {
  unavailable: "The migration status did not answer. This window stays read-only until it does.",
  "removing-other": "Another device is removing the old data. This window stays read-only until it finishes.",
  incomplete: "A migration to files is unfinished in this folder.",
};

/** A banner with one action; a failed action keeps the banner and says so. */
function MigrateBanner({ message, action, onAction }: { message: string; action: string; onAction: () => Promise<boolean> | boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div role="alert" className="migrate-097-banner">
      <p>{message}</p>
      {failed ? <p>That did not work. Try again.</p> : null}
      <Button
        onClick={() => {
          void Promise.resolve(onAction()).then((ok) => setFailed(!ok));
        }}
      >
        {action}
      </Button>
    </div>
  );
}

/** The folder and migration the window reads now. */
async function readKey(): Promise<WiringKey> {
  const shell = desktop();
  const folder = (await shell?.vaultRoot().catch(() => null))?.path ?? null;
  return { folder, migration: await migrate097Status(shell, folder) };
}

/**
 * Mounted once in the root layout. Outside the desktop shell it renders its
 * children unchanged. Inside, it shows the upgrade screen for an incomplete
 * folder, and reloads the window when the folder or a verified migration
 * differs from the wiring built at startup, since the container is wired once.
 */
export function Migrate097Gate({ children }: { children?: React.ReactNode }) {
  const [upgradeFolder, setUpgradeFolder] = useState<string | null>(null);
  const [banner, setBanner] = useState<WiringKey | null>(null);
  const built = useRef<WiringKey | null>(null);

  useEffect(() => {
    const shell = desktop();
    if (!shell) return;
    let alive = true;
    void readKey().then((key) => {
      if (!alive) return;
      built.current = key;
      setBanner(key);
      if (shouldShowUpgrade(key.migration ?? "unavailable", key.folder)) setUpgradeFolder(key.folder);
    });
    const off = shell.onVaultChange(() => {
      void readKey().then((now) => {
        const startup = built.current;
        if (alive && startup && wiringNeedsReload(startup, now)) window.location.reload();
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const state: Migrate097Resolved = banner?.migration ?? "unavailable";
  const folder = banner?.folder ?? null;
  const retryState = state === "unavailable" || state === "removing-other" || state === "incomplete" ? state : null;

  return (
    <>
      {children}
      {retryState && shouldShowRetry(state, folder) ? (
        <MigrateBanner
          message={BANNER_TEXT[retryState]}
          action="Retry"
          onAction={() => {
            window.location.reload();
            return true;
          }}
        />
      ) : null}
      {shouldShowFinishRemoving(state, folder) && folder ? (
        <MigrateBanner
          message="Removing the old data on this device was interrupted. Finish removing to complete the migration."
          action="Finish removing"
          onAction={async () => {
            const shell = desktop();
            if (!shell?.migrate097RemoveOld) return false;
            try {
              await shell.migrate097RemoveOld(folder);
            } catch {
              return false;
            }
            window.location.reload();
            return true;
          }}
        />
      ) : null}
      {upgradeFolder ? (
        <Migrate097Upgrade
          folder={upgradeFolder}
          runExport={null}
          onReady={() => window.location.reload()}
          onKeepOld={() => setUpgradeFolder(null)}
        />
      ) : null}
    </>
  );
}
