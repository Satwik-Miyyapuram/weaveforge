"use client";

import { useState } from "react";
import { useAuth } from "@/features/auth";
import { Modal } from "@/components/modal";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import { authHeaders } from "@/lib/auth-headers";
import { clearStoredAppearance } from "@/lib/theme/theme";
import { Button } from "@/components/button";

const CONFIRMATION = "DELETE_USER";

/** Danger zone: permanent account + data deletion (email OTP required). */
export function DeleteAccountPanel() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetModal() {
    setConfirmation("");
    setOtp("");
    setOtpSent(false);
    setEmailHint(null);
    setError(null);
  }

  async function sendOtp() {
    setSendingOtp(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete-user/otp", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
      });
      const payload = (await res.json()) as { error?: string; emailHint?: string };
      if (!res.ok) throw new Error(payload.error ?? "Could not send confirmation code.");
      setOtpSent(true);
      setEmailHint(payload.emailHint ?? user?.email ?? null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleDelete() {
    if (confirmation !== CONFIRMATION || !otp.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete-user", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ confirmation: CONFIRMATION, otp: otp.trim() }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Deletion failed.");

      clearStoredAppearance();

      await signOut();
      window.location.href = "/";
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card add-form delete-account-panel">
      <h3 className="settings-group">Delete account</h3>
      <p className="muted">
        Permanently delete your account and all associated data (papers, experiments, images,
        settings). We email a one-time code to confirm it is you. This cannot be undone.
      </p>
      <Button
       
        size="sm" className="danger"
        onClick={() => {
          resetModal();
          setOpen(true);
        }}
      >
        Delete my account…
      </Button>

      {open && (
        <Modal
          title="Delete account"
          onClose={() => {
            if (busy || sendingOtp) return;
            setOpen(false);
            resetModal();
          }}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            This removes all your projects, papers, uploads, and profile from WeaveForge. First
            send a code to your account email, then confirm below.
          </p>

          <div className="field">
            <Button
              disabled={busy || sendingOtp}
              onClick={() => void sendOtp()}
            >
              {sendingOtp ? "Sending…" : otpSent ? "Resend code" : "Email me a confirmation code"}
            </Button>
            {otpSent && emailHint && (
              <p className="muted" style={{ marginBottom: 0 }}>
                Code sent to {emailHint}. Enter the 6-digit code (or paste the confirmation link).
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="delete-otp">Confirmation code</label>
            <input
              id="delete-otp"
              type="text"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="6-digit code or confirmation link"
              disabled={busy}
            />
          </div>

          <div className="field">
            <label htmlFor="delete-confirm">
              Type <strong>{CONFIRMATION}</strong> to confirm
            </label>
            <input
              id="delete-confirm"
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>

          {error && <FormError>{error}</FormError>}
          <Button
            variant="primary"
            style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
            disabled={busy || sendingOtp || confirmation !== CONFIRMATION || !otp.trim()}
            onClick={() => void handleDelete()}
          >
            {busy ? "Deleting…" : "Delete my account permanently"}
          </Button>
        </Modal>
      )}
    </div>
  );
}
