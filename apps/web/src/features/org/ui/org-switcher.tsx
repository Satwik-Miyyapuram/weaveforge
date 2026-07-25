"use client";

import { useState } from "react";
import { isExplicitLabMembership, ROLE_LABELS } from "@thesis/core";
import { useProfile } from "./profile-provider";

/** Header chip for switching between labs when the user has multiple memberships. */
export function OrgSwitcher() {
  const { profile, memberships, activeOrgId, switchOrg } = useProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const labs = memberships.filter(isExplicitLabMembership);
  if (!profile || labs.length <= 1) return null;

  const active =
    labs.find((m) => m.orgId === activeOrgId) ?? labs[0]!;

  async function pick(orgId: string) {
    if (orgId === activeOrgId || busy) return;
    setBusy(true);
    try {
      await switchOrg(orgId);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="proj-switcher org-switcher">
      <button
        type="button"
        className="proj-chip"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch lab"
      >
        <span className="org-dot" aria-hidden />
        <span>{active.orgName}</span>
        <span className="chev">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="proj-menu" onMouseLeave={() => setOpen(false)}>
          {labs.map((m) => (
            <button
              key={m.orgId}
              type="button"
              className={`proj-menu-item${m.orgId === activeOrgId ? " sel" : ""}`}
              disabled={busy}
              onClick={() => void pick(m.orgId)}
            >
              <span className="org-dot" aria-hidden />
              <span className="org-menu-label">
                <span>{m.orgName}</span>
                <span className="muted org-menu-role">{ROLE_LABELS[m.role]}</span>
              </span>
              {m.orgId === activeOrgId && <span className="check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
