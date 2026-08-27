"use client";

import { useEffect, useState } from "react";
import { formatError } from "@/lib/format-error";
import { desktop, type DesktopLocalApi } from "@/lib/desktop/desktop-bridge";

/**
 * Settings → Folder → the local HTTP surface.
 *
 * A door, and the user opens it. Nothing here is on by default, the token is
 * shown once and never again, and switching the door off throws the key away
 * rather than keeping it for next time.
 *
 * Desktop only. There is no browser equivalent and there should not be one: a
 * page cannot listen on a port, and anything that could would be a service
 * running on somebody's machine without a window to close.
 */
export function LocalApiPanel() {
  const [state, setState] = useState<DesktopLocalApi | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let live = true;
    void bridge
      .localApiState()
      .then((value) => {
        if (live) setState(value);
      })
      .catch(() => {
        // An older shell without the channel. The section simply does not appear.
      });
    return () => {
      live = false;
    };
  }, []);

  if (!state) return null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const bridge = desktop();
      if (!bridge) return;
      const next = await bridge.setLocalApi(enabled);
      setState(next);
      setToken(next.token ?? null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h4 className="settings-group">Let other apps in</h4>
      <p className="muted jump-to-meta">
        Serve the folder over HTTP on this machine only, using the same routes as
        Obsidian&rsquo;s local REST API, so tools written for that already work. Nothing outside
        this computer can reach it.
      </p>
      {error && <p className="error">{error}</p>}
      <label className="field-inline">
        <input
          type="checkbox"
          className="themed-check"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Serve the folder at {state.url}
      </label>
      {state.reason && <p className="error">{state.reason}</p>}
      {token && (
        <div className="field">
          <p className="muted jump-to-meta">
            This is the only time this token is shown. Copy it now; switching the surface off and
            on again issues a new one and stops this one working.
          </p>
          <code className="wiki-lint-list">{token}</code>
        </div>
      )}
    </>
  );
}
