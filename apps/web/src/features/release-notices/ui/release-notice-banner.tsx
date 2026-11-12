import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Button } from "@/components/button";
import type { ReleaseNotice } from "@/features/settings/infrastructure/parts";

/**
 * The newest release notice this account has not dismissed. Plain text only;
 * dismissing records the version against the account and hides the banner.
 */
export function ReleaseNoticeBanner() {
  const [notice, setNotice] = useState<ReleaseNotice | null>(null);
  useEffect(() => {
    let cancelled = false;
    // A failed lookup just means no banner.
    Promise.resolve()
      .then(() => getContainer().settings.releaseNotices.unseen())
      .then((found) => {
        if (!cancelled) setNotice(found);
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
          setNotice(null);
          Promise.resolve()
            .then(() => getContainer().settings.preferences.saveNoticeSeen(version))
            .catch(() => {});
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
