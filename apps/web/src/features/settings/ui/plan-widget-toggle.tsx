"use client";

import { useEffect, useState } from "react";
import { FormError } from "@/components/form-error";
import { desktop, type DesktopPlanWidget } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";

/**
 * Settings → Calendar, desktop app on Windows only: the deadlines widget that
 * sits on the wallpaper, under every window.
 *
 * It reads the plan the desktop shell keeps on this computer in files mode, so
 * the toggle is always available when the bridge supports the widget.
 */
export function PlanWidgetToggle() {
  const bridge = desktop();
  const [state, setState] = useState<DesktopPlanWidget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge?.planWidgetState) return;
    let live = true;
    bridge.planWidgetState().then(
      (value) => live && setState(value),
      (err: unknown) => live && setError(formatError(err)),
    );
    return () => {
      live = false;
    };
  }, [bridge]);

  if (!bridge?.setPlanWidget || !state?.supported) return null;
  const setPlanWidget = bridge.setPlanWidget;

  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      setState(await setPlanWidget(on));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="calendar-feed-desktop" aria-labelledby="calendar-desktop-title">
      <h3 id="calendar-desktop-title" className="settings-group">
        On your desktop
      </h3>
      <p className="muted api-token-intro">
        A small card on your wallpaper with your next deadlines. It stays under your windows, shows through Show
        desktop, and starts with Windows. Drag its header to move it.
      </p>
      <FormError>{error}</FormError>
      <label className="calendar-feed-check">
        <input className="wf-check"
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Show deadlines on the desktop
      </label>
    </section>
  );
}
