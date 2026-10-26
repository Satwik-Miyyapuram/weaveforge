"use client";

import { useEffect, useState } from "react";
import {
  ROLE_LABELS,
  creatableRoles,
  hasActiveLab,
  type Role,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { Select } from "@/components/select";
import { useProfile } from "./profile-provider";
import { OrgChart } from "./member-tree";
import { OrgCodesPanel, OrgLabModal } from "./org-setup-gate";
import { OrgSwitcher } from "./org-switcher";
import { fetchOwnedOrgs, leaveOrg } from "../infrastructure/org-api";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { ownedOrgsOrError, type OwnedOrg } from "./owned-orgs";
import { Button } from "@/components/button";

/**
 * People / Organization panel. Embedded in Settings (not its own screen). Shows
 * your role and the full lab org chart, and — if your role permits — lets you
 * provision accounts one level down. Creation and visibility rules are enforced
 * rules are enforced server-side; this UI only exposes the affordances allowed.
 */
export function OrgPanel() {
  const { profile, labMembers, memberships, activeOrgId, loading, refresh } = useProfile();
  const [ownedOrgs, setOwnedOrgs] = useState<OwnedOrg[]>([]);
  const [ownedError, setOwnedError] = useState<string | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const activeMembership =
    memberships.find((m) => m.orgId === activeOrgId)
    ?? memberships.find((m) => m.joinSource === "invite" || m.joinSource === "create")
    ?? null;
  const isOrgHead =
    profile?.role === "professor" &&
    ownedOrgs.some((org) => org.ownerId === profile.id);
  const ownsActiveOrg =
    !!profile &&
    !!activeMembership &&
    ownedOrgs.some((org) => org.id === activeMembership.orgId && org.ownerId === profile.id);
  const isInOrg = hasActiveLab(activeOrgId, memberships, ownsActiveOrg);
  const canLeaveActiveOrg = isInOrg && !!activeMembership && !ownsActiveOrg;

  useEffect(() => {
    if (profile?.role !== "professor") {
      setOwnedOrgs([]);
      setOwnedError(null);
      return;
    }
    let current = true;
    void ownedOrgsOrError(fetchOwnedOrgs).then(({ orgs, error }) => {
      if (!current) return;
      setOwnedOrgs(orgs);
      setOwnedError(error);
    });
    // Keyed on the profile, so a response for the previous one must not land.
    return () => {
      current = false;
    };
  }, [profile?.id, profile?.role]);

  const allowedRoles = profile ? creatableRoles(profile.role) : [];
  const [addOpen, setAddOpen] = useState(false);

  async function handleLeaveOrg() {
    if (!activeMembership) return;
    setLeaveBusy(true);
    setLeaveError(null);
    try {
      await leaveOrg(activeMembership.orgId);
      await refresh();
    } catch (err) {
      setLeaveError(formatError(err));
    } finally {
      setLeaveBusy(false);
      setLeaveAsk(false);
    }
  }

  if (loading) {
    return (
      <div className="card add-form">
        <h3 className="settings-group">People</h3>
        <ScreenLoader status="Loading organization…" compact showTips={false} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="card add-form">
        <h3 className="settings-group">Organization</h3>
        <OrgEmptyRow onAction={() => setLabOpen(true)} />
        {labOpen && (
          <OrgLabModal open={labOpen} onClose={() => { setLabOpen(false); void refresh(); }} />
        )}
      </div>
    );
  }

  return (
    <div className="card add-form">
      <h3 className="settings-group">Organization</h3>
      <OrgSwitcher />
      {!isInOrg ? (
        <OrgEmptyRow onAction={() => setLabOpen(true)} />
      ) : (
        <>
          <p className="muted">
            {isOrgHead
              ? "Share invite codes so others can join your lab."
              : ownsActiveOrg
                ? `You own ${activeMembership?.orgName ?? "this lab"}. Share invite codes below so others can join.`
                : `You're in ${activeMembership?.orgName ?? "a lab"}. Your supervisor and teammates are listed below.`}
          </p>
          <div className="head-row org-panel-actions">
            <Button onClick={() => setLabOpen(true)}>
              Create / join another lab
            </Button>
            {canLeaveActiveOrg && (
              <button
                type="button"
                className="link-btn danger"
                disabled={leaveBusy}
                onClick={() => setLeaveAsk(true)}
              >
                {leaveBusy ? "Leaving…" : `Leave ${activeMembership?.orgName ?? "lab"}`}
              </button>
            )}
          </div>
        </>
      )}

      {leaveError && <FormError>{leaveError}</FormError>}
      {ownedError && <FormError>{ownedError}</FormError>}

      {isOrgHead && (
        <>
          {ownedOrgs.map((org) => (
            <OrgCodesPanel key={org.id} orgId={org.id} orgName={org.name} />
          ))}
        </>
      )}
      {labOpen && (
        <OrgLabModal open={labOpen} onClose={() => { setLabOpen(false); void refresh(); }} />
      )}

      <h3 className="settings-group" style={{ marginTop: 20 }}>People</h3>
      {allowedRoles.length > 0 && (
        <div className="head-row">
          <div className="screen-actions">
            <Button onClick={() => setAddOpen(true)}>New account</Button>
          </div>
        </div>
      )}

      {addOpen && (
        <Modal title="Create an account" onClose={() => setAddOpen(false)}>
          <CreateAccountForm
            allowedRoles={allowedRoles}
            onCreated={async () => { setAddOpen(false); await refresh(); }}
          />
        </Modal>
      )}

      {/* Leaving a lab cannot be undone from here: it needs a new invite (D-07). */}
      {leaveAsk && activeMembership && (
        <ConfirmDialog
          title="Leave lab?"
          body={`You leave ${activeMembership.orgName}. You can rejoin later with an invite code.`}
          confirmLabel="Leave lab"
          danger
          busy={leaveBusy}
          onConfirm={() => void handleLeaveOrg()}
          onClose={() => setLeaveAsk(false)}
        />
      )}

      {labMembers.length === 0 || (!isInOrg && labMembers.every((m) => m.id === profile.id)) ? (
        <p className="muted" style={{ marginTop: 12 }}>
          {isInOrg ? "No teammates visible yet." : "Just you for now — join a lab to see your team here."}
        </p>
      ) : (
        <OrgChart members={labMembers} meId={profile.id} inLab={isInOrg} />
      )}
    </div>
  );
}

function OrgEmptyRow({ onAction }: { onAction: () => void }) {
  return (
    <div className="org-empty-row">
      <p className="muted org-empty-text">You are not part of any org yet.</p>
      <Button onClick={onAction}>
        Create or join
      </Button>
    </div>
  );
}

function CreateAccountForm({
  allowedRoles,
  onCreated,
}: {
  allowedRoles: Role[];
  onCreated: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(allowedRoles[0] ?? "masters");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const created = await getContainer().org.createMember.create({
        email,
        password,
        fullName: fullName || undefined,
        role,
      });
      setDone(`Created ${created.email} as ${ROLE_LABELS[created.role]}.`);
      setEmail("");
      setFullName("");
      setPassword("");
      await onCreated();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card add-form" onSubmit={submit}>
      <h3 className="settings-group">Create an account</h3>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        The new member will be supervised by you.
      </p>

      <div className="field">
        <label htmlFor="new-role">Role</label>
        <Select
          id="new-role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {allowedRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </Select>
      </div>

      <div className="field">
        <label htmlFor="new-name">Full name</label>
        <input
          id="new-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ada Lovelace"
        />
      </div>
      <div className="field">
        <label htmlFor="new-email">Email</label>
        <input
          id="new-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ada@university.edu"
          autoComplete="off"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">Temporary password</label>
        <input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="at least 8 characters"
          autoComplete="new-password"
          required
        />
      </div>

      {error && <FormError>{error}</FormError>}
      {done && <p className="muted">{done}</p>}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
}
