"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { appUpdateView } from "../application/app-update-view";
import { useAppUpdate } from "./use-app-update";

/**
 * The one-click notice for a newer desktop release, shown above the page.
 *
 * "Later" hides the notice for the release it was about; the next release
 * shows it again. Nothing installs until the button is pressed. A failed
 * check is not shown here; a release that did not install is.
 */
export function AppUpdateNotice() {
  const { status, install } = useAppUpdate();
  const [laterVersion, setLaterVersion] = useState<string | null>(null);
  // The status an error was dismissed on; the shell's next status shows again.
  const [dismissed, setDismissed] = useState<typeof status>(null);
  if (!status) return null;
  // A failed check found no release: the automatic check is silent here, and the update settings show its error.
  if (status.phase === "failed" && status.version === null) return null;
  const view = appUpdateView(status);
  if (!view.notice && !view.error) return null;
  if (status.phase === "available" && laterVersion === status.version) return null;
  if (status === dismissed) return null;

  return (
    <div className="release-notice-banner" role={view.error ? "alert" : "status"}>
      <strong>{view.notice ?? view.error}</strong>
      {view.notice && view.error ? <p className="release-notice-body">{view.error}</p> : null}
      {view.canInstall ? (
        <Button size="sm" onClick={install}>
          {view.installLabel}
        </Button>
      ) : null}
      {status.phase === "available" ? (
        <Button size="sm" onClick={() => setLaterVersion(status.version)}>
          Later
        </Button>
      ) : null}
      {view.error ? (
        <Button size="sm" onClick={() => setDismissed(status)}>
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}
