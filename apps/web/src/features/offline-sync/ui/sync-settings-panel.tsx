"use client";

import { useState } from "react";
import { useAuth } from "@/features/auth";
import { formatError } from "@/lib/format-error";
import { useSyncStatus } from "./use-sync";

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
      <div className="settings-group">
        <h3>Sync</h3>
        <p className="muted">
          This device syncs with your account. Everything still works with the network off; changes
          travel when it comes back.
        </p>
        <p className="muted">
          {status.lastPullAt
            ? `Last checked ${new Date(status.lastPullAt).toLocaleString()}.`
            : "Not checked yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="settings-group">
      <h3>Sync</h3>
      <p className="muted">
        Your work lives on this machine and needs no account. Turning sync on copies it to an
        account so another machine can see it too. Nothing leaves this device until you do.
      </p>
      {!user && <p className="muted">Sign in first, and this becomes one button.</p>}
      {error && <p className="error">{error}</p>}
      <button
        type="button"
        className="btn-secondary"
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
      </button>
    </div>
  );
}
