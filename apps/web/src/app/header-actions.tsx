"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/features/org/ui/profile-provider";
import { useProject } from "@/features/projects";
import { getContainer } from "@/bootstrap";
import { Popover } from "@/components/popover";
import { SubmenuFlyout } from "@/components/menu";
import { isExplicitLabMembership, ROLE_LABELS, type Role } from "@weaveforge/core";
import { ThemeToggle } from "./theme-toggle";
import { accountLinks, type AccountLinkId } from "./account-links";
import { NavIcon } from "./nav-icon";
import { useInbox } from "./use-inbox";
import { LocalModeBadge } from "@/features/auth/ui/local-mode-badge";
import { SyncStatusIndicator } from "./lazy-sync-status";
import { RowButton } from "@/components/controls";
import { useLiveSync } from "@/features/offline-sync/ui/use-live-sync";
import { syncStatus } from "@/features/offline-sync/domain/sync-status";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { accountAttention } from "./account-attention";

/** A person, for the account menu. The ellipsis said "more things"; this says
 *  whose things they are, which is what the menu contains. */
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const BuildingIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" />
  </svg>
);

const GridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);
const HelpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

/**
 * Account actions (Supervise / Shared / Settings / Sign out). Rendered two ways:
 *  - `variant="list"` (default): labelled links, for a bar with the height.
 *  - `variant="menu"`: one "⋯" opening the same rows as a menu.
 *
 * The menu goes through `Popover` rather than its own absolutely-positioned
 * panel. It used to be `.header-menu { position: absolute; top: 100% }` inside
 * the sidebar's bottom block, which is `overflow-y: auto` — so the menu was
 * rendered, and clipped away. `Popover` portals the panel out of that box and
 * flips it above the trigger when there is no room below, which is the drop-up
 * the sidebar needs and the drop-down the mobile top bar gets, from one rule.
 */
export function HeaderActions({
  variant = "list",
  inbox = true,
}: {
  variant?: "list" | "menu";
  /** The Inbox rows, where no sidebar shows them: the phone and the project picker. */
  inbox?: boolean;
}) {
  const { user, signOut } = useAuth();
  const { profile, memberships, activeOrgId, switchOrg } = useProfile();
  const { current, setProject } = useProject();
  const router = useRouter();
  const pathname = usePathname();
  const { links: inboxRows, local } = useInbox();
  const live = useLiveSync();
  const attention = accountAttention({ conflicts: live.conflictsCount, inbox: inboxRows, inboxInMenu: inbox });
  // Sync runs on the desktop only; its state is words in the menu, not a dot.
  const sync = desktop() ? syncStatus(live) : null;
  const labs = memberships ? memberships.filter(isExplicitLabMembership) : [];

  if (!user) return null;

  const ICONS: Record<AccountLinkId, () => React.JSX.Element> = {
    projects: GridIcon,
    settings: GearIcon,
    docs: HelpIcon,
    signout: LogoutIcon,
    signin: LogoutIcon,
  };
  const TITLES: Partial<Record<AccountLinkId, string>> = {
    projects: "Projects",
    settings: "Settings",
    docs: "Documentation",
  };

  /**
   * Rendered from `accountLinks`, so which entries exist — and which
   * deliberately do not — is decided in one tested place rather than in JSX.
   *
   * A function of `close` because the two variants get their closer from
   * different places: the list variant has no panel to shut, the menu variant's
   * comes from `Popover`. An entry that navigates or acts has to close the menu
   * itself — nothing else knows the click happened.
   */
  const links = (close: () => void) => (
    <>
      {/* Theme is one of the account controls, so it is a row of this menu
          rather than a button beside it. Two of each was the bug. */}
      <ThemeToggle />
      {labs.length > 1 && (
        <OrgMenuSubmenu
          labs={labs}
          activeOrgId={activeOrgId}
          switchOrg={switchOrg}
          closeMenu={close}
        />
      )}
      {inbox &&
        inboxRows.map((row) => (
          <Link key={row.key} href={row.path} className="header-link" onClick={close}>
            <NavIcon name={row.icon} />
            <span>{row.label}</span>
            {row.badge !== undefined && <b className="nav-badge">{row.badge}</b>}
          </Link>
        ))}
      {accountLinks({ hasProject: !!current, local }).map((link) => {
        const Icon = ICONS[link.id];

        // Leaving offline mode is not signing out — there is no session to end.
        // It puts the sign-in screen back, and the local data stays where it is.
        if (link.id === "signin") {
          return (
            <RowButton
              key={link.id}
              className="signout"
              onClick={() => {
                getContainer().auth.setLocalMode(false);
                window.location.reload();
              }}
              title="Sign in to sync this work with an account. What is on this computer stays here."
            >
              <Icon /><span>{link.label}</span>
            </RowButton>
          );
        }
        if (link.id === "signout") {
          return (
            <RowButton key={link.id} className="signout" onClick={() => void signOut()} title={user.email}>
              <Icon /><span>{link.label}</span>
            </RowButton>
          );
        }
        if (link.id === "projects") {
          // Return to the project picker. ProjectSwitcher hides when no project
          // is selected, so without this there is no way back from account routes
          // (/settings, /shared, /supervision) once a project is deselected.
          return (
            <RowButton
              key={link.id}
              className="header-link"
              title={TITLES[link.id]}
              onClick={() => {
                setProject(null);
                router.push("/dashboard");
                close();
              }}
            >
              <Icon /><span>{link.label}</span>
            </RowButton>
          );
        }
        // External links open in a new tab — losing unsaved work to a
        // documentation link would be its own small betrayal.
        if (link.external) {
          return (
            <a key={link.id} href={link.href} className="header-link" title={TITLES[link.id]} target="_blank" rel="noreferrer" onClick={close}>
              <Icon /><span>{link.label}</span>
            </a>
          );
        }
        return (
          <Link key={link.id} href={link.href!} className="header-link" title={TITLES[link.id]} onClick={close}>
            <Icon /><span>{link.label}</span>
          </Link>
        );
      })}
    </>
  );

  if (variant === "list") {
    return (
      <div className="header-actions">
        <LocalModeBadge />
        <SyncStatusIndicator attentionOnly />
        {links(() => {})}
      </div>
    );
  }

  return (
    <Popover
      portal
      align="right"
      // The person icon says what it is; a caret beside it made the control look
      // like a disclosure that folds, and animated on every open.
      iconOnly
      ariaLabel={attention.total > 0 ? `Account, ${attention.total} waiting` : "Account"}
      triggerClassName="account-btn"
      label={<UserIcon />}
      count={attention.total}
    >
      {(close) => (
        <>
          {/* Whose menu this is (DA-97); the trigger is only a person icon. */}
          {(profile?.fullName || user.email) && (
            <div className="account-menu-head">
              {profile?.fullName && <b>{profile.fullName}</b>}
              {user.email && <span>{user.email}</span>}
              {sync && sync.state !== "conflict" && <span className="account-menu-sync">{sync.label}</span>}
            </div>
          )}
          {/* What needs the person comes first; the icon's count is these. */}
          {attention.rows.map((row) => (
            <RowButton
              key={row.key}
              className="header-link"
              onClick={() => {
                close();
                // Same-page push does not fire hashchange; setting the hash does, and Settings listens.
                const [path, hash] = row.path.split("#");
                if (hash && pathname === path) window.location.hash = hash;
                else router.push(row.path);
              }}
            >
              <NavIcon name={row.icon} />
              <span>{row.label}</span>
              <b className="nav-badge">{row.badge}</b>
            </RowButton>
          ))}
          {links(close)}
        </>
      )}
    </Popover>
  );
}

function OrgMenuSubmenu({
  labs,
  activeOrgId,
  switchOrg,
  closeMenu,
}: {
  labs: Array<{ orgId: string; orgName: string; role: Role }>;
  activeOrgId: string | null;
  switchOrg: (id: string) => Promise<void>;
  closeMenu: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const active = labs.find((m) => m.orgId === activeOrgId) ?? labs[0]!;

  return (
    <div className="menu-row card-menu-row" ref={rowRef}>
      <RowButton
        className="header-link menu-item card-menu-item"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Current lab: ${active.orgName}. Click to switch.`}
      >
        <BuildingIcon />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {active.orgName}
        </span>
        <span className="card-menu-more menu-more" aria-hidden="true" style={{ marginLeft: "auto", opacity: 0.65 }}>
          ›
        </span>
      </RowButton>
      {open && (
        <SubmenuFlyout anchorRef={rowRef}>
          <div className="org-menu-flyout-list" style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "200px" }}>
            {labs.map((m) => (
              <RowButton
                key={m.orgId}
                className={`proj-menu-item${m.orgId === activeOrgId ? " sel" : ""}`}
                disabled={busy}
                onClick={async () => {
                  if (m.orgId === activeOrgId || busy) return;
                  setBusy(true);
                  try {
                    await switchOrg(m.orgId);
                    setOpen(false);
                    closeMenu();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span className="org-dot" aria-hidden="true" />
                <span className="org-menu-label">
                  <span>{m.orgName}</span>
                  <span className="muted org-menu-role">{ROLE_LABELS[m.role]}</span>
                </span>
                {m.orgId === activeOrgId && <span className="check">✓</span>}
              </RowButton>
            ))}
          </div>
        </SubmenuFlyout>
      )}
    </div>
  );
}
