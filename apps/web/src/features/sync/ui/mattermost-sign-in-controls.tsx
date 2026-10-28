"use client";

import { useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { readStored, writeStored } from "@/lib/safe-storage";
import type { Integration } from "../domain/integration";
import { MattermostSignInButton } from "./mattermost-sign-in-button";
import { Switch } from "@/components/controls";

/**
 * Whether this project's Mattermost token comes from sign-in or is a bot token.
 *
 * A per-reader choice about how the token in the `token` slot was obtained,
 * not a stored field — both end up as one token. Sign-in is the default; a
 * saved bot token keeps its own mode.
 */
export function useMattermostSignIn(projectId: string, hasToken: boolean): [boolean, (on: boolean) => void] {
  const modeKey = `wf.mm-signin.${projectId}`;
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    const stored = readStored(modeKey);
    setSignIn(stored === "1" || (stored === null && !hasToken));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mode is chosen once per project
  }, [modeKey]);
  function choose(on: boolean) {
    setSignIn(on);
    writeStored(modeKey, on ? "1" : "0");
  }
  return [signIn, choose];
}

/** The web-posting caveat, the sign-in/bot-token switch and, in sign-in mode, the sign-in button. */
export function MattermostSignInControls({
  value,
  signIn,
  onChooseSignIn,
  onToken,
}: {
  value: Integration;
  signIn: boolean;
  onChooseSignIn: (on: boolean) => void;
  onToken: (token: string) => void;
}) {
  return (
    <>
      {!desktop()?.mattermostPost && (
        <p className="muted">
          Posting from the website only works if your Mattermost server allows it. Servers run by
          universities and other institutions usually block it, so if test messages fail here, connect
          Mattermost from the desktop app instead.
        </p>
      )}
      <div className="integration-enable">
        <span>Sign in with Mattermost instead of a bot token</span>
        <Switch checked={signIn} label="Sign in with Mattermost instead of a bot token"
          onClick={() => onChooseSignIn(!signIn)} />
      </div>
      {signIn && (
        <>
          {value.token && <p className="muted">Signed in to {value.repo}.</p>}
          <MattermostSignInButton
            serverUrl={value.repo ?? ""}
            label={value.token ? "Sign in again" : "Sign in with Mattermost"}
            onToken={onToken}
          />
        </>
      )}
    </>
  );
}
