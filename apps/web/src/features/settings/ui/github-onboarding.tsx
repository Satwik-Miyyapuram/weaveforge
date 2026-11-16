"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { readStored, writeStored } from "@/lib/safe-storage";
import { folderRemoteSync, githubConnectAvailable } from "@/features/workspace/application/parts-2";
import { GithubConnect } from "./github-connect";

/** Set once the card is answered: "skipped" or "connected". */
export const GITHUB_ONBOARDING_KEY = "weaveforge.githubOnboarding";

/**
 * GitHub sync is on by default: once a workspace folder is chosen and has no
 * remote yet, this card offers it, with Connect GitHub first. Skip keeps
 * server sync and the card never comes back; Settings → Workspace folder
 * still has the button. Paints nothing in a browser or on an older shell.
 */
export function GithubOnboarding() {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!githubConnectAvailable() || readStored(GITHUB_ONBOARDING_KEY)) return;
    let live = true;
    // Rejects when no folder is chosen yet: nothing to sync, so no card.
    void folderRemoteSync("settings")
      .then((reply) => {
        if (live && !reply.url) setShow(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!show) return null;

  const close = (answer: "skipped" | "connected") => {
    writeStored(GITHUB_ONBOARDING_KEY, answer);
    setShow(false);
  };

  return (
    <aside className="release-notice-banner github-onboarding" aria-label="Sync with GitHub">
      <strong>Sync with GitHub</strong>
      <p className="release-notice-body">
        Your notes sync to your own private GitHub repository. Our server only relays live sessions and shared
        items.
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
