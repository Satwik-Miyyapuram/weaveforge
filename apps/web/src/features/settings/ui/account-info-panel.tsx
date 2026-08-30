"use client";

import { hasActiveLab, needsStandaloneRoleSync, resolveDisplayRole, ROLE_LABELS } from "@weaveforge/core";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/features/org";
import { Modal } from "@/components/modal";
import { useState } from "react";
import { formatError } from "@/lib/format-error";
import { useCapability } from "@/deployment/capabilities";

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function labStatus(
  loading: boolean,
  orgSetupComplete: boolean | undefined,
  inLab: boolean,
  labName: string | null,
): string {
  if (loading) return "Loading…";
  if (orgSetupComplete === false) return "Setup pending — create or join a lab";
  if (inLab && labName) return labName;
  return "Standalone — no lab";
}

/** Signed-in account summary for Settings (helps distinguish test accounts). */
export function AccountInfoPanel() {
  const { user, updatePassword } = useAuth();
  const { profile, memberships, activeOrgId, loading } = useProfile();
  const hasOrgs = useCapability("org");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  if (!user) return null;

  const activeMembership =
    memberships.find((m) => m.orgId === activeOrgId)
    ?? memberships.find((m) => m.joinSource === "invite" || m.joinSource === "create")
    ?? null;
  const inLab = hasActiveLab(activeOrgId, memberships);
  const ownsOrg = memberships.some((m) => m.joinSource === "create");
  const displayRole = resolveDisplayRole(profile?.role ?? "standalone", { inLab, ownsOrg });
  const labName = activeMembership?.orgName ?? null;
  const hasEmailPassword = user.providers.includes("email");

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("new-password") ?? "");
    const confirmation = String(data.get("confirm-password") ?? "");
    setPasswordError(null);
    setPasswordSuccess(false);
    if (password !== confirmation) {
      setPasswordError("The passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await updatePassword(password);
      event.currentTarget.reset();
      setPasswordSuccess(true);
    } catch (err) {
      setPasswordError(formatError(err));
    } finally {
      setPasswordBusy(false);
    }
  }

  // Role and Organization are positions inside a lab. A copy with no account
  // is not standalone *within* anything — the concept is absent, and printing
  // "Standalone — no lab" invites the reader to go looking for the lab screen
  // that this copy does not have either.
  const rows: { label: string; value: string }[] = [
    { label: "Name", value: profile?.fullName ?? "—" },
    { label: "Email", value: user.email ?? profile?.email ?? "—" },
    { label: "Account ID", value: shortId(user.id) },
    ...(hasOrgs
      ? [
          {
            label: "Role",
            value: loading ? "Loading…" : ROLE_LABELS[displayRole] ?? displayRole,
          },
          {
            label: "Organization",
            value: labStatus(loading, profile?.orgSetupComplete, inLab, labName),
          },
        ]
      : []),
  ];

  return (
    <div id="settings-account" className="card add-form account-info-panel settings-anchor" style={{ marginBottom: "24px" }}>
      <h3 className="settings-group">Account</h3>
      <p className="muted" style={{ margin: "4px 0 0" }}>
        {hasOrgs
          ? "Signed-in identity — useful when switching between test accounts."
          : "This copy is working on your computer, with no account. Sign in to add a lab, sharing and another device."}
      </p>
      <dl className="account-info-grid">
        {rows.map(({ label, value }) => (
          <div key={label} className="account-info-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {hasEmailPassword && (
        <div className="card-foot edit-actions account-password-actions">
          <span className="muted">Login password</span>
          <button type="button" className="btn-secondary" onClick={() => { setPasswordError(null); setPasswordSuccess(false); setPasswordOpen(true); }}>
            Change password
          </button>
        </div>
      )}
      {passwordOpen && hasEmailPassword && (
        <Modal title="Change login password" onClose={() => !passwordBusy && setPasswordOpen(false)}>
          <form className="crypto-recovery-modal-content" onSubmit={(event) => void changePassword(event)}>
            <p className="muted">This changes the password used to sign in.</p>
            <label className="field"><span>New password</span><input name="new-password" type="password" autoComplete="new-password" minLength={8} required /></label>
            <label className="field"><span>Retype new password</span><input name="confirm-password" type="password" autoComplete="new-password" minLength={8} required /></label>
            {passwordError && <p className="error">{passwordError}</p>}
            {passwordSuccess && <p className="success">Your login password was changed.</p>}
            <div className="button-row">
              <button type="submit" className="btn-primary" disabled={passwordBusy}>{passwordBusy ? "Saving…" : "Change password"}</button>
              <button type="button" className="btn-secondary" onClick={() => setPasswordOpen(false)} disabled={passwordBusy}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
