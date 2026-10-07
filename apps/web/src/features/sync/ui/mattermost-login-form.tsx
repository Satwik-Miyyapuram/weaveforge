"use client";

import { useState } from "react";
import { loginForSessionToken } from "../infrastructure/mattermost-login";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";

/**
 * The app's own Mattermost sign-in: username and password typed here, traded
 * for a session token via the server's login API. An alternative to a bot
 * token / PAT for readers who have no personal access token.
 */
export function MattermostLoginForm({
  serverUrl,
  onToken,
  submitLabel = "Sign in",
}: {
  serverUrl: string;
  onToken: (token: string) => void | Promise<void>;
  submitLabel?: string;
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!serverUrl.trim()) {
      setError("Enter the server URL first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await loginForSessionToken(serverUrl, loginId, password, mfa.trim() || undefined);
      await onToken(token);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-form">
      <div className="field">
        <label>Username or email</label>
        <input
          type="text"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label>MFA code (if enabled)</label>
        <input
          type="text"
          value={mfa}
          onChange={(e) => setMfa(e.target.value)}
          placeholder="optional"
          autoComplete="off"
          inputMode="numeric"
        />
      </div>
      {error && <FormError>{error}</FormError>}
      <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
        {busy ? "Signing in…" : submitLabel}
      </button>
    </div>
  );
}
