"use client";

import { useRef, useState } from "react";
import { isExplicitLabMembership, ROLE_LABELS, type Member, type OrgMembershipView } from "@weaveforge/core";
import { useProfile } from "./profile-provider";
import { ChevronIcon } from "@/components/chevron-icon";
import { formatError } from "@/lib/format-error";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { Button } from "@/components/button";
import { MenuItemButton } from "@/components/controls";

/** Header chip for switching between labs when the user has multiple memberships. */
export function OrgSwitcher() {
  const { profile, memberships, activeOrgId, switchOrg } = useProfile();
  return <OrgSwitcherView profile={profile} memberships={memberships} activeOrgId={activeOrgId} switchOrg={switchOrg} />;
}

export interface OrgSwitcherViewProps {
  profile: Member | null;
  memberships: OrgMembershipView[];
  activeOrgId: string | null;
  switchOrg: (orgId: string) => Promise<void>;
}

/** The switcher itself, apart from the profile context so it can be tested. */
export function OrgSwitcherView({ profile, memberships, activeOrgId, switchOrg }: OrgSwitcherViewProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => setOpen(false), ref);

  const labs = memberships.filter(isExplicitLabMembership);
  if (!profile || labs.length <= 1) return null;

  const active =
    labs.find((m) => m.orgId === activeOrgId) ?? labs[0]!;

  async function pick(orgId: string) {
    if (orgId === activeOrgId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await switchOrg(orgId);
      setOpen(false);
    } catch (err) {
      setError(`Could not switch lab: ${formatError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="proj-switcher org-switcher" ref={ref}>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch lab"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="org-dot" aria-hidden />
        <span>{active.orgName}</span>
        <ChevronIcon />
      </Button>
      {open && (
        <div className="proj-menu" onMouseLeave={() => setOpen(false)}>
          {labs.map((m) => (
            <MenuItemButton
              kind="radio"
              checked={m.orgId === activeOrgId}
              key={m.orgId}
              disabled={busy}
              onClick={() => void pick(m.orgId)}
            >
              <span className="org-dot" aria-hidden />
              <span className="org-menu-label">
                <span>{m.orgName}</span>
                <span className="muted org-menu-role">{ROLE_LABELS[m.role]}</span>
              </span>
            </MenuItemButton>
          ))}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
