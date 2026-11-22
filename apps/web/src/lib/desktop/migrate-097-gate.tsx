"use client";

import { useEffect, useRef, useState } from "react";

import { wiringNeedsReload, type WiringKey } from "@/container/wiring-key";
import { desktop } from "./desktop-bridge";
import { shouldShowUpgrade } from "./migrate-097-gate-decision";
import { migrate097Status } from "./migrate-097";
import { Migrate097Upgrade } from "./migrate-097-upgrade";

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
  const built = useRef<WiringKey | null>(null);

  useEffect(() => {
    const shell = desktop();
    if (!shell) return;
    let alive = true;
    void readKey().then((key) => {
      if (!alive) return;
      built.current = key;
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

  return (
    <>
      {children}
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
