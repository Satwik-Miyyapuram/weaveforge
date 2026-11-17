"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { appUpdateView } from "../application/app-update-view";
import { useAppUpdate } from "./use-app-update";

/**
 * The one-click notice for a newer desktop release, shown above the page.
 *
 * "Later" hides the notice for the release it was about; the next release
 * shows it again. Nothing installs until the button is pressed.
 */
export function AppUpdateNotice() {
  const { status, install } = useAppUpdate();
  const [laterVersion, setLaterVersion] = useState<string | null>(null);
  if (!status) return null;
  const view = appUpdateView(status);
  if (!view.notice && !view.error) return null;
  if (status.phase === "available" && laterVersion === status.version) return null;

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
    </div>
  );
}
