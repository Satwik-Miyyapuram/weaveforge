"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/ui/auth-provider";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";

/** The card every status branch of the reset screen sits in. */
export function ResetShell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="app-shell">
      <div className="card crypto-setup-card">
        <h1 className="screen-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function PasswordResetScreen() {
  const { user, loading, updatePassword } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    setError(null);
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <ResetShell title="Checking your reset link…" />;
  if (!user) {
    return (
      <ResetShell title="Reset link unavailable">
        <FormError>This link is expired or has already been used. Request a new password reset email.</FormError>
      </ResetShell>
    );
  }
  if (done) {
    return (
      <ResetShell title="Password changed">
        <p className="muted">Your login password has been updated. Your encryption recovery credentials are unchanged.</p>
        <button type="button" className="btn-primary" onClick={() => router.replace("/dashboard")}>Continue</button>
      </ResetShell>
    );
  }
  return (
    <main className="app-shell">
      <form className="card crypto-setup-card" onSubmit={(event) => void submit(event)}>
        <h1 className="screen-title">Choose a new password</h1>
        <p className="muted">This changes your login password only. It does not replace your encryption recovery link, passphrase, or recovery code.</p>
        <label className="field"><span>New password</span><input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <label className="field"><span>Retype new password</span><input name="confirmation" type="password" autoComplete="new-password" minLength={8} required /></label>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
      </form>
    </main>
  );
}
