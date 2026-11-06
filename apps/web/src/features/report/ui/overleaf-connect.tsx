"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import type { WorkshopSession } from "./use-workshop-session";

type ConnectMode = "signin" | "git";

const SIGN_IN_TIP =
  "Opens overleaf.com in an app window. Works on any plan; Overleaf compiles the PDF; in the desktop app you can also edit the files live. " +
  "Saved browser passwords don't fill in there, but Google/ORCID sign-in and desktop password managers work. " +
  "Google may refuse embedded windows.";

const GIT_TIP =
  "Pull and push the project as files in your vault and compile locally. Needs an Overleaf plan or institution " +
  "licence with Git (TU Delft has one); the git token lasts about a year; needs local LaTeX " +
  "(MiKTeX, TeX Live or Tectonic).";

/** The two ways to connect. The tip holds the details; the hint is the one line always shown. */
const CONNECT_OPTIONS: readonly { mode: ConnectMode; label: string; hint: string; tip: string }[] = [
  { mode: "signin", label: "Sign in to Overleaf", hint: "Any plan. Edit live, see the PDF and the outline.", tip: SIGN_IN_TIP },
  { mode: "git", label: "Edit as files (Git token)", hint: "Paid or institution plan. Edit in your vault, compile locally.", tip: GIT_TIP },
];

/** The connect step: sign in (app window or pasted cookie), or go to Settings for a git token. */
export function OverleafConnect({ session, hasSignInWindow, inShell, canEditAsFiles }: {
  session: WorkshopSession;
  hasSignInWindow: boolean;
  inShell: boolean;
  canEditAsFiles: boolean;
}) {
  const [mode, setMode] = useState<ConnectMode>("signin");
  const [cookies, setCookies] = useState("");

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (await session.signInWithCookie(cookies)) setCookies("");
  }

  const cookieForm = (
    <form className="linked-overleaf-form" onSubmit={(event) => void submit(event)}>
      <label>
        Overleaf session cookie
        <input
          name="cookies"
          type="password"
          autoComplete="off"
          placeholder="overleaf_session2=…"
          value={cookies}
          onChange={(event) => setCookies(event.target.value)}
        />
      </label>
      <p className="muted">
        Copy the <code>overleaf_session2</code> cookie from overleaf.com.{" "}
        {inShell
          ? "It is kept encrypted in this device's keychain, is never shown again, and is removed when you sign out."
          : "It is stored encrypted on the server and never shown again."}
      </p>
      <div className="linked-overleaf-form__actions">
        <Button variant="primary" type="submit" disabled={session.busy || !cookies.trim()}>
          {session.busy ? "Connecting…" : "Connect Overleaf"}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="overleaf-connect">
      <fieldset className="overleaf-connect__choice">
        <legend>How do you want to connect?</legend>
        {CONNECT_OPTIONS.map((option) => (
          <label key={option.mode} title={option.tip} className="overleaf-connect__option">
            <input
              type="radio"
              name="overleafConnect"
              value={option.mode}
              checked={mode === option.mode}
              onChange={() => setMode(option.mode)}
            />
            <span>
              <strong>{option.label}</strong>
              <span className="muted"> {option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "git" ? (
        canEditAsFiles ? (
          <div className="linked-overleaf-form__actions">
            <Button href="/settings#settings-workspace" title="Save your Overleaf git token and link a project to a vault folder">
              Open Overleaf projects in Settings
            </Button>
          </div>
        ) : (
          <p className="muted">Editing as files needs the WeaveForge desktop app.</p>
        )
      ) : hasSignInWindow ? (
        <>
          <div className="linked-overleaf-form__actions">
            <Button variant="primary" disabled={session.busy} onClick={() => void session.signInWithWindow()} title={SIGN_IN_TIP}>
              {session.busy ? "Waiting for sign-in…" : "Sign in to Overleaf"}
            </Button>
          </div>
          <details className="overleaf-connect__fallback">
            <summary>Paste a session cookie instead</summary>
            {cookieForm}
          </details>
        </>
      ) : (
        cookieForm
      )}
    </div>
  );
}
