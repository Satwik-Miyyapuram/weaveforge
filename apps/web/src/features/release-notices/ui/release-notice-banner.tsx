import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Button } from "@/components/button";
import type { ReleaseNotice } from "@/features/settings/infrastructure/parts";

/** The version this device dismissed. Device-local: the account is never read or written. */
const SEEN_KEY = "wf.releaseNotice.seen";

/** The dismissed version on this device, or null when unset or storage is blocked. */
function readSeen(): string | null {
  try {
    return globalThis.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Remember the dismissal on this device; a blocked store just means it may show again. */
function writeSeen(version: string): void {
  try {
    globalThis.localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Nothing to do: the banner still hides for this view.
  }
}

/**
 * The newest release notice this device has not dismissed. Plain text only; dismissing
 * records the version in localStorage and hides the banner.
 */
export function ReleaseNoticeBanner() {
  const [notice, setNotice] = useState<ReleaseNotice | null>(null);
  useEffect(() => {
    let cancelled = false;
    // A failed lookup just means no banner.
    Promise.resolve()
      .then(() => getContainer().settings.releaseNotices.latest())
      .then((found) => {
        if (!cancelled && found && found.version !== readSeen()) setNotice(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!notice) return null;
  const { version, title, body } = notice;
  return (
    <div className="release-notice-banner" role="status">
      <strong>{title}</strong>
      <p className="release-notice-body">{body}</p>
      <Button
        size="sm"
        onClick={() => {
          writeSeen(version);
          setNotice(null);
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
