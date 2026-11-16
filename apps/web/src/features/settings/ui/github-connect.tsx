"use client";

import { useEffect, useRef, useState } from "react";
import type { DesktopGithubCode, DesktopGithubConnected } from "@/lib/desktop/desktop-bridge";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import {
  cancelGithubConnect,
  finishGithubConnect,
  startGithubConnect,
} from "@/features/workspace/application/parts-2";

/**
 * One click to sync with GitHub: show the device code, open GitHub's page for
 * it, wait while the shell polls, then name the private repo it made. The
 * token never reaches the page.
 */
export function GithubConnect({
  onConnected,
  extra,
}: {
  onConnected?: (connected: DesktopGithubConnected) => void;
  /** Buttons beside Connect GitHub while idle, such as Skip. */
  extra?: React.ReactNode;
}) {
  const [code, setCode] = useState<DesktopGithubCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<DesktopGithubConnected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Bumped by Cancel and unmount, so a late answer from an old wait is dropped.
  const turn = useRef(0);

  useEffect(
    () => () => {
      turn.current += 1;
    },
    [],
  );

  async function connect() {
    const mine = ++turn.current;
    setBusy(true);
    setError(null);
    setConnected(null);
    setCopied(false);
    try {
      const next = await startGithubConnect();
      if (mine !== turn.current) return;
      setCode(next);
      window.open(next.verificationUri, "_blank", "noopener");
      const done = await finishGithubConnect(null);
      if (mine !== turn.current) return;
      setConnected(done);
      onConnected?.(done);
    } catch (err) {
      if (mine === turn.current) setError(formatError(err));
    } finally {
      if (mine === turn.current) {
        setBusy(false);
        setCode(null);
      }
    }
  }

  function cancel() {
    turn.current += 1;
    setBusy(false);
    setCode(null);
    void cancelGithubConnect().catch(() => undefined);
  }

  return (
    <div className="github-connect">
      {code && (
        <div className="github-connect-wait">
          <p className="muted">Enter this code on the GitHub page that opened:</p>
          <div className="github-code-row">
            <code className="github-code">{code.userCode}</code>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard
                  .writeText(code.userCode)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="muted github-connect-waiting" role="status" aria-live="polite">
            <span className="github-spinner" aria-hidden="true" /> Waiting for GitHub…{" "}
            <Button variant="link" onClick={() => window.open(code.verificationUri, "_blank", "noopener")}>
              Open the page again
            </Button>
          </p>
          <div className="screen-actions screen-actions--start">
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!code && (
        <div className="screen-actions screen-actions--start">
          <Button variant="primary" disabled={busy} onClick={() => void connect()}>
            {busy ? "Asking GitHub…" : "Connect GitHub"}
          </Button>
          {extra}
        </div>
      )}
      {connected && (
        <p className="muted" role="status">
          Connected to <strong>{connected.repo}</strong>.
          {connected.created ? " The private repository was made for you." : " The existing private repository is used."}
        </p>
      )}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
