"use client";

import { useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";

/**
 * Sign in on the Mattermost server's own login page, in a desktop window, so
 * the app never handles a password. Web has no such window: it says so.
 * There is no default server: until the user names one, the button is off.
 */
export function MattermostSignInButton({
  serverUrl,
  onToken,
  label = "Sign in with Mattermost",
}: {
  serverUrl: string;
  onToken: (token: string) => void | Promise<void>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = desktop()?.mattermostSignIn;
  const server = serverUrl.trim();

  if (!signIn) {
    return <p className="muted">Mattermost sign-in works in the desktop app. Here, use a bot token instead.</p>;
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const token = await signIn!(server);
      if (token) await onToken(token);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-form">
      {error && <FormError>{error}</FormError>}
      {!server && <p className="muted">Enter your Mattermost server URL to sign in.</p>}
      <Button variant="primary" onClick={() => void run()} disabled={busy || !server}>
        {busy ? "Waiting for sign-in…" : label}
      </Button>
    </div>
  );
}
