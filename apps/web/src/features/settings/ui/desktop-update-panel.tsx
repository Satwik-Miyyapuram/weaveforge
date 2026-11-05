"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop, type DesktopUpdate } from "@/lib/desktop/desktop-bridge";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";

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

/** "off" here stops the check that runs when Settings opens; Check now still works. */
const AUTO_CHECK_KEY = "weaveforge.desktop.autoUpdateCheck";

function readAutoCheck(): boolean {
  try { return window.localStorage.getItem(AUTO_CHECK_KEY) !== "off"; } catch { return true; }
}

function writeAutoCheck(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(AUTO_CHECK_KEY);
    else window.localStorage.setItem(AUTO_CHECK_KEY, "off");
  } catch { /* not remembered; the check stays on next time */ }
}

/** idle: the automatic check is off and nobody has asked yet. */
type CheckStatus = "idle" | "checking" | "done" | "failed";

export function useDesktopUpdate(): {
  checked: boolean;
  failed: boolean;
  idle: boolean;
  update: DesktopUpdate | null;
  recheck: () => void;
} {
  const [state, setState] = useState<{ status: CheckStatus; update: DesktopUpdate | null }>(
    () => (cached ? { status: "done", update: cached.update } : { status: "checking", update: null }),
  );

  const run = useCallback((force: boolean) => {
    const bridge = desktop();
    // In a browser there is no window to update, so there is nothing to say
    // and nothing to ask.
    if (!bridge) {
      setState({ status: "done", update: null });
      return;
    }
    if (!force && cached && Date.now() - cached.at < FRESH_MS) {
      setState({ status: "done", update: cached.update });
      return;
    }
    if (!force && !readAutoCheck()) {
      setState({ status: "idle", update: null });
      return;
    }
    setState((s) => ({ ...s, status: "checking" }));
    void bridge
      .checkUpdate()
      .then((update) => {
        cached = { at: Date.now(), update };
        setState({ status: "done", update });
      })
      .catch(() => {
        // A failed check is not "up to date", and is not cached: the next
        // look asks again.
        setState({ status: "failed", update: null });
      });
  }, []);

  useEffect(() => run(false), [run]);

  return {
    checked: state.status !== "checking",
    failed: state.status === "failed",
    idle: state.status === "idle",
    update: state.update,
    recheck: () => run(true),
  };
}

export function DesktopUpdatePanel() {
  const bridge = desktop();
  const { checked, failed, idle, update, recheck } = useDesktopUpdate();
  const [asked, setAsked] = useState(false);
  const [autoCheck, setAutoCheck] = useState(readAutoCheck);

  const check = () => {
    setAsked(true);
    recheck();
  };

  if (!bridge) return null;

  return (
    <div className="add-form settings-card">
      <h3 className="settings-group">Updates</h3>
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
          <Button variant="primary" href={update.url} target="_blank" rel="noreferrer">
            Get {update.version}
          </Button>
        </div>
      ) : failed ? (
        <FormError reportable={false}>Could not check for updates. Try again.</FormError>
      ) : (
        <p className="muted">
          {!checked
            ? "Checking…"
            : idle
              ? "The automatic check is off."
              : asked
                ? "No newer version. This is the current desktop window."
                : "No newer version."}
        </p>
      )}

      <Button onClick={check} disabled={!checked}>
        {checked ? "Check now" : "Checking…"}
      </Button>

      <label className="ai-permission-row">
        <span>Check when Settings opens</span>
        <input
          className="wf-check"
          type="checkbox"
          name="autoUpdateCheck"
          checked={autoCheck}
          onChange={(e) => {
            writeAutoCheck(e.target.checked);
            setAutoCheck(e.target.checked);
          }}
        />
      </label>
    </div>
  );
}
