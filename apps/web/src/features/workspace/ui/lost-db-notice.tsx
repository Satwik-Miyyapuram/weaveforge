"use client";

import { useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { lostDbNotice } from "../application/folder-lost-db-guard";

/**
 * The banner shown above the page when the local database was recreated empty.
 * It names where the old data was kept aside and that folder sync waits for a restart.
 * A failed state lookup shows nothing rather than an error.
 */
export function LostDbNotice() {
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await desktop()?.localDbState();
        if (!cancelled) setNotice(lostDbNotice(state));
      } catch {
        if (!cancelled) setNotice(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice) return null;
  return (
    <div className="release-notice-banner" role="alert">
      <strong>{notice.title}</strong>
      <p className="release-notice-body">{notice.body}</p>
    </div>
  );
}
