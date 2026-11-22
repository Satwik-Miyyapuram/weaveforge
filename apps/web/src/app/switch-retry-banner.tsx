import { useState, useSyncExternalStore } from "react";
import { readBackendConfig } from "@/backend/parts";
import { Button } from "@/components/button";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { decideBrowserSwitchFromConfig } from "@/container/browser-switch-wiring";
import {
  SWITCH_RETRY_TEXT,
  isSwitchRetryNeeded,
  retrySwitch,
  subscribeSwitchRetry,
} from "@/container/browser-switch-retry";

/**
 * Shown while this browser's files are not ready and the server backend is in use. Retry runs the
 * switch again and reloads into files mode when it switches. Markup mirrors ReleaseNoticeBanner,
 * since the codebase has no generic Banner component.
 */
export function SwitchRetryBanner() {
  const needed = useSyncExternalStore(subscribeSwitchRetry, isSwitchRetryNeeded, () => false);
  const [busy, setBusy] = useState(false);
  if (!needed) return null;
  return (
    <div className="release-notice-banner" role="status">
      <p className="release-notice-body">{SWITCH_RETRY_TEXT}</p>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void retrySwitch(
            () => decideBrowserSwitchFromConfig(readBackendConfig(), desktop()),
            () => window.location.reload(),
          ).finally(() => setBusy(false));
        }}
      >
        Retry
      </Button>
    </div>
  );
}
