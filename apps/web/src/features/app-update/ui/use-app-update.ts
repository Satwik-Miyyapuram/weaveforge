"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop, type DesktopAppUpdate } from "@/lib/desktop/desktop-bridge";

const UNREACHABLE = "Could not reach the updater. Try again.";

/** A status for an unanswered request; `current` is filled in by the caller's own version. */
function failedStatus(error: string, prev?: DesktopAppUpdate | null): DesktopAppUpdate {
  return {
    phase: "failed",
    current: prev?.current ?? "",
    version: prev?.version ?? null,
    percent: null,
    error,
  };
}

/**
 * The installed window's update state, kept current by the shell's own events.
 *
 * `status` is null where there is no one-click support (a browser, or a shell
 * that predates it), so callers render nothing rather than a dead button.
 */
export function useAppUpdate(): {
  status: DesktopAppUpdate | null;
  check: () => void;
  install: () => void;
} {
  const [status, setStatus] = useState<DesktopAppUpdate | null>(null);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge || !bridge.appUpdateStatus) return;
    let cancelled = false;
    const read = bridge.appUpdateStatus.bind(bridge);
    const stop = bridge.onAppUpdate?.((next) => {
      if (!cancelled) setStatus(next);
    });
    void read()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        // Never stall on "checking": an unanswered read is shown as a failure.
        if (!cancelled) setStatus((prev) => prev ?? failedStatus(UNREACHABLE));
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const run = useCallback((action: "appUpdateCheck" | "appUpdateInstall") => {
    const bridge = desktop();
    const call = bridge?.[action];
    if (!bridge || !call) return;
    call.call(bridge)
      .then((next) => setStatus(next))
      .catch(() => {
        // The shell did not answer at all. Keep the release it was offering so
        // the retry still has something to install.
        setStatus((prev) => failedStatus(UNREACHABLE, prev));
      });
  }, []);

  return {
    status,
    check: useCallback(() => run("appUpdateCheck"), [run]),
    install: useCallback(() => run("appUpdateInstall"), [run]),
  };
}
