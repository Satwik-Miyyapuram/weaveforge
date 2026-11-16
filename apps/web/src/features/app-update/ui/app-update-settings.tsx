"use client";

import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { appUpdateView } from "../application/app-update-view";
import { useAppUpdate } from "./use-app-update";

/** The Settings block for the one-click update: the version, a check, and the same install button. */
export function AppUpdateSettings({ version }: { version: string }) {
  const { status, check, install } = useAppUpdate();
  const view = status ? appUpdateView(status) : null;

  return (
    <div className="add-form settings-card">
      <h3 className="settings-group">Updates</h3>
      <p className="muted">
        WeaveForge checks for a new version in the background and tells you when one is ready.
        Installing it takes one click; the window then restarts on the new version.
      </p>

      <dl className="kv">
        <div>
          <dt>Current version</dt>
          <dd>{status?.current || version}</dd>
        </div>
      </dl>

      <p className="muted">{view ? view.summary : "Checking for a new version…"}</p>
      {view?.error ? <FormError reportable={false}>{view.error}</FormError> : null}

      <Button onClick={check} disabled={!view?.canCheck}>
        Check for updates
      </Button>
      {view?.canInstall ? (
        <Button variant="primary" onClick={install}>
          {view.installLabel}
        </Button>
      ) : null}
    </div>
  );
}
