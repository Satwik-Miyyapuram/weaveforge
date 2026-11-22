"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { desktop } from "./desktop-bridge";
import { canRemoveOld, removeOldData, type RemoveOldDeps } from "./migrate-097-remove-old";

/** Body of the install dialog shown when this machine has no keychain for the secrets. */
export const KEYCHAIN_INSTALL_BODY =
  "WeaveForge keeps your secrets in the system keychain. This machine has no keychain available, so the old data is kept. Install or enable a keychain service, then try again.";

/**
 * "Remove old data" on the upgrade report. Renders nothing unless the
 * migration is verified and not yet removed; a click only opens the confirm
 * dialog. Confirm runs verify, then the secrets move, then the remove. The
 * remove never runs unless the move succeeded.
 */
export function RemoveOldDataButton({
  folder,
  state,
  removedAt,
  exportedHere,
  backupPath,
  deps,
  onRemoved,
}: {
  folder: string;
  state: "none" | "verified" | "incomplete";
  removedAt?: string;
  exportedHere?: boolean;
  backupPath?: string;
  deps: RemoveOldDeps;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [keychainMissing, setKeychainMissing] = useState(false);
  if (!canRemoveOld({ state, removedAt, exportedHere, backupPath }) || !backupPath) return null;

  async function confirm() {
    setBusy(true);
    setRefused(false);
    try {
      const outcome = await removeOldData(desktop(), deps, folder);
      setOpen(false);
      if (outcome === "removed") {
        onRemoved();
      } else if (outcome === "keychain-missing") {
        setKeychainMissing(true);
      } else {
        setRefused(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="danger" disabled={busy} onClick={() => setOpen(true)}>
        Remove old data
      </Button>
      {open ? (
        <ConfirmDialog
          title="Remove old data?"
          body={`This deletes the old local database data. A backup stays at ${backupPath ?? ""}. This cannot be undone from WeaveForge.`}
          confirmLabel="Remove old data"
          danger
          busy={busy}
          onConfirm={confirm}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {keychainMissing ? (
        <ConfirmDialog
          title="Keychain needed"
          body={KEYCHAIN_INSTALL_BODY}
          confirmLabel="OK"
          onConfirm={() => setKeychainMissing(false)}
          onClose={() => setKeychainMissing(false)}
        />
      ) : null}
      {refused ? (
        <FormError>The upgrade check did not pass, so nothing was removed. Run the upgrade again.</FormError>
      ) : null}
    </>
  );
}

/**
 * Settings entry for the remove-old action. Hidden unless both the verify and
 * the secrets move are injected (fail closed until WEB-EXPORT and KEYS merge)
 * and the status carries every field the button needs.
 */
export function RemoveOldDataSection({ deps = null }: { deps?: RemoveOldDeps | null }) {
  const [view, setView] = useState<{
    folder: string;
    state: "none" | "verified" | "incomplete";
    removedAt?: string;
    exportedHere?: boolean;
    backupPath?: string;
  } | null>(null);
  const ready = Boolean(deps?.verify && deps.moveSecrets);

  useEffect(() => {
    const bridge = desktop();
    if (!ready || !bridge?.vaultRoot || !bridge.migrate097Status) return;
    let alive = true;
    void (async () => {
      try {
        const root = await bridge.vaultRoot();
        if (!root?.path) return;
        const status = await bridge.migrate097Status!(root.path);
        if (alive) {
          setView({
            folder: root.path,
            // Only a verified report can offer removal; every other state maps to none (fail closed).
            state: status.state === "verified" || status.state === "incomplete" ? status.state : "none",
            removedAt: status.removedAt,
            exportedHere: status.exportedHere,
            backupPath: status.backupPath,
          });
        }
      } catch {
        // No status to show: the section stays hidden.
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  if (!deps || !ready || !view) return null;
  return (
    <RemoveOldDataButton
      folder={view.folder}
      state={view.state}
      removedAt={view.removedAt}
      exportedHere={view.exportedHere}
      backupPath={view.backupPath}
      deps={deps}
      onRemoved={() => setView(null)}
    />
  );
}
