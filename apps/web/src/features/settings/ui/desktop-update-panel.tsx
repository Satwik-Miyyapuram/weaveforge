"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop, type DesktopUpdate } from "@/lib/desktop-bridge";

/**
 * Updates, for the desktop window only.
 *
 * Almost nothing about WeaveForge needs updating: the window loads this app
 * from the server, so a change to it arrives the next time the window opens.
 * What ships inside the installer is the window itself — signing in, links,
 * file handling — and that is what this section is about. Saying so is most of
 * the section's job, because "you are three versions behind" is alarming if
 * you think it means the app, and unremarkable once you know it means the
 * frame around it.
 *
 * The shell announces an update once, in a dialog, when a sign-in completes.
 * Between those, this is where the fact lives, and the tab carries a dot so it
 * can be noticed without being answered.
 */

/**
 * The check, shared by the panel and the tab's dot.
 *
 * The result is held in a module-level cache rather than fetched per mount,
 * because both callers want the same answer and the second one arriving would
 * otherwise be a second call to GitHub for it.
 */
let cached: { at: number; update: DesktopUpdate | null } | null = null;
const FRESH_MS = 60 * 60 * 1000;

export function useDesktopUpdate(): { checked: boolean; update: DesktopUpdate | null; recheck: () => void } {
  const [state, setState] = useState<{ checked: boolean; update: DesktopUpdate | null }>(
    () => (cached ? { checked: true, update: cached.update } : { checked: false, update: null }),
  );

  const run = useCallback((force: boolean) => {
    const bridge = desktop();
    // In a browser there is no window to update, so there is nothing to say
    // and nothing to ask.
    if (!bridge) {
      setState({ checked: true, update: null });
      return;
    }
    if (!force && cached && Date.now() - cached.at < FRESH_MS) {
      setState({ checked: true, update: cached.update });
      return;
    }
    setState((s) => ({ ...s, checked: false }));
    void bridge
      .checkUpdate()
      .then((update) => {
        cached = { at: Date.now(), update };
        setState({ checked: true, update });
      })
      .catch(() => {
        // Unreachable GitHub is not an error worth showing. The honest state
        // is "nothing to report", which is what an up-to-date app looks like.
        cached = { at: Date.now(), update: null };
        setState({ checked: true, update: null });
      });
  }, []);

  useEffect(() => run(false), [run]);

  return { ...state, recheck: () => run(true) };
}

export function DesktopUpdatePanel() {
  const bridge = desktop();
  const { checked, update, recheck } = useDesktopUpdate();
  const [asked, setAsked] = useState(false);

  const check = () => {
    setAsked(true);
    recheck();
  };

  if (!bridge) return null;

  return (
    <div className="card settings-card">
      <h2>Updates</h2>
      <p className="muted">
        The app itself updates from the web — whatever this window loads is the current
        version, the same as a browser tab. Only the desktop window is installed on this
        machine, and only it can be out of date.
      </p>

      <dl className="kv">
        <div>
          <dt>Desktop window</dt>
          <dd>{bridge.version}</dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd>{bridge.platform}</dd>
        </div>
      </dl>

      {update ? (
        <div className="callout">
          <p>
            <b>Version {update.version} is available.</b> Downloading opens the release page
            in your browser; nothing is installed without you.
          </p>
          <a className="btn-primary" href={update.url} target="_blank" rel="noreferrer">
            Get {update.version}
          </a>
        </div>
      ) : (
        <p className="muted">
          {!checked
            ? "Checking…"
            : asked
              ? "No newer version. This is the current desktop window."
              : "No newer version."}
        </p>
      )}

      <button type="button" className="btn-secondary" onClick={check} disabled={!checked}>
        {checked ? "Check now" : "Checking…"}
      </button>
    </div>
  );
}
