"use client";

import { formatError } from "@/lib/format-error";
import { localOffset } from "@/lib/parts-1";
import { readyCore } from "@/lib/rust-core";
import { useState } from "react";
import { useAuth } from "@/features/auth";
import { useSyncStatus } from "./use-sync";
import { FormError } from "@/components/form-error";
import { requestSync } from "../domain/parts-1";
import { Button } from "@/components/button";

/**
 * Settings → Sync.
 *
 * The only place in the app that asks for an account, and it only asks here.
 * On a machine that cannot sync — a browser tab, with no local database — the
 * section is absent rather than disabled: a control that can never do anything
 * is a control the reader learns to distrust.
 */
export function SyncSettingsPanel() {
  const { status, refresh } = useSyncStatus();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status.supported) return null;

  if (status.enabled) {
    return (
      <div className="settings-block">
        <h3 className="settings-group">Sync</h3>
        <p className="muted">
          This device syncs with your account. Everything still works with the network off; changes
          travel when it comes back.
        </p>
        <p className="muted">
          {status.lastPullAt
            ? `Last checked ${readyCore().formatDateTime(status.lastPullAt, localOffset(status.lastPullAt))}.`
            : "Not checked yet."}
        </p>
        <Button
          onClick={() => {
            requestSync();
            refresh();
          }}
        >
          Sync now
        </Button>
      </div>
    );
  }

  return (
    <div className="settings-block">
      <h3 className="settings-group">Sync</h3>
      <p className="muted">
        Your work lives on this machine and needs no account. Turning sync on copies it to an
        account so another machine can see it too. Nothing leaves this device until you do.
      </p>
      {!user && <p className="muted">Sign in first, and this becomes one button.</p>}
      {error && <FormError>{error}</FormError>}
      <div className="field-inline">
        <Button
          disabled={!user || busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            import("./enable-sync")
              .then(({ enableSync }) => enableSync())
              .then(refresh)
              .catch((err: unknown) => setError(formatError(err)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Turning on…" : "Turn on sync"}
        </Button>
      </div>
    </div>
  );
}
