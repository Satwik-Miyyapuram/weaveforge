"use client";

import { useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";

/** The server the sign-in opens when the connection names none. */
export const DEFAULT_MATTERMOST_SERVER = "https://mattermost.tudelft.nl";

/**
 * Sign in on the Mattermost server's own login page, in a desktop window, so
 * the app never handles a password. Web has no such window: it says so.
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

  if (!signIn) {
    return <p className="muted">Mattermost sign-in works in the desktop app. Here, use a bot token instead.</p>;
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const token = await signIn!(serverUrl.trim() || DEFAULT_MATTERMOST_SERVER);
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
      <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy}>
        {busy ? "Waiting for sign-in…" : label}
      </button>
    </div>
  );
}
