"use client";

import { useState } from "react";
import { formatError } from "@/lib/format-error";

/**
 * The shape every add/edit form in the app shares: disable while the work is in
 * flight, show whatever it threw, and never leave the button stuck on "Adding…".
 *
 * `action` throwing is how a form reports a validation failure — the message is
 * what the user sees. `submit` resolves true only when the action succeeded,
 * so a caller can close its dialog on success and keep it open on failure.
 */
export function useSubmit(action: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: React.FormEvent): Promise<boolean> {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(formatError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, submit };
}
