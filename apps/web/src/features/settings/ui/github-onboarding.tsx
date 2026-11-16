"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { readStored, writeStored } from "@/lib/safe-storage";
import {
  folderRemoteSync,
  githubConnectAvailable,
  onGithubReauth,
} from "@/features/workspace/application/parts-2";
import { GithubConnect } from "./github-connect";

/** Set once the card is answered: "skipped" or "connected". */
export const GITHUB_ONBOARDING_KEY = "weaveforge.githubOnboarding";

/**
 * GitHub sync is on by default: once a workspace folder is chosen and has no
 * remote yet, this card offers it, with Connect GitHub first. Skip keeps
 * server sync and the card never comes back; Settings → Workspace folder
 * still has the button. When GitHub refuses the stored token, at start or
 * on any later sync, the card comes back, even after Skip, to ask for a new
 * sign-in. Paints nothing in a browser or on an older shell.
 */
export function GithubOnboarding() {
  const [show, setShow] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!githubConnectAvailable()) return;
    let live = true;
    const ask = () => {
      setReauth(true);
      setDone(false);
      setShow(true);
    };
    const answered = readStored(GITHUB_ONBOARDING_KEY);
    // Rejects when no folder is chosen yet: nothing to sync, so no card.
    void folderRemoteSync("settings")
      .then((reply) => {
        if (!live) return;
        if (reply.needsReconnect) ask();
        else if (!answered && !reply.url) setShow(true);
      })
      .catch(() => undefined);
    const stop = onGithubReauth(() => {
      if (live) ask();
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  if (!show) return null;

  const close = (answer: "skipped" | "connected") => {
    writeStored(GITHUB_ONBOARDING_KEY, answer);
    setShow(false);
  };

  if (reauth) {
    return (
      <aside className="release-notice-banner github-onboarding" aria-label="Sign in to GitHub again">
        <strong>Sync with GitHub paused</strong>
        <GithubConnect
          needsReconnect
          onConnected={() => setDone(true)}
          extra={
            <Button variant="ghost" title="Ask again on the next sync" onClick={() => setShow(false)}>
              Later
            </Button>
          }
        />
        {done && (
          <Button variant="secondary" onClick={() => close("connected")}>
            Done
          </Button>
        )}
      </aside>
    );
  }

  return (
    <aside className="release-notice-banner github-onboarding" aria-label="Sync with GitHub">
      <strong>Sync with GitHub</strong>
      <p className="release-notice-body">
        Your notes sync to your own private GitHub repository. GitHub holds your synced files; the WeaveForge
        server only relays live shared sessions.
      </p>
      <ul className="github-onboarding-points">
        <li>You own the data and its full history.</li>
        <li>Works when our server is down.</li>
        <li>Needs a GitHub account.</li>
        <li>GitHub can read what is in your private repository.</li>
        <li>Syncs every few seconds, not instantly.</li>
      </ul>
      <GithubConnect
        onConnected={() => {
          writeStored(GITHUB_ONBOARDING_KEY, "connected");
          setDone(true);
        }}
        extra={
          <Button variant="ghost" title="Keep syncing through the WeaveForge server" onClick={() => close("skipped")}>
            Skip
          </Button>
        }
      />
      {done && (
        <Button variant="secondary" onClick={() => close("connected")}>
          Done
        </Button>
      )}
    </aside>
  );
}
