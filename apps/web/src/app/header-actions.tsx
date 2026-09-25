"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/features/org/ui/profile-provider";
import { useProject } from "@/features/projects";
import { getContainer } from "@/bootstrap";
import { Popover } from "@/components/popover";
import { ThemeToggle } from "./theme-toggle";
import { accountLinks, type AccountLinkId } from "./account-links";
import { isOfflineBuild } from "@/deployment/build-target";
import { LocalModeBadge } from "@/features/auth/ui/local-mode-badge";


/** A person, for the account menu. The ellipsis said "more things"; this says
 *  whose things they are, which is what the menu contains. */
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const GridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="action-icon">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
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
export function HeaderActions({ variant = "list" }: { variant?: "list" | "menu" }) {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { current, setProject } = useProject();
  const router = useRouter();
  const [pendingProposals, setPendingProposals] = useState(0);
  const [local, setLocal] = useState(false);

  useEffect(() => {
    const read = () =>
      void getContainer().aiProposals.pendingCount().then(setPendingProposals).catch(() => setPendingProposals(0));
    // On mount the memoized count is what we want — three copies of this
    // component mount as the breakpoint settles. On an explicit change event it
    // is exactly what we do not want, so drop it first.
    const refresh = () => {
      getContainer().aiProposals.forgetPending();
      read();
    };
    read();
    // Read through the auth facade rather than the local backend provider: this
    // component only needs the answer, and reaching for the provider is how a
    // presentation file ends up knowing which backend a window was built with.
    setLocal(getContainer().auth.isLocalMode());
    window.addEventListener("ai-proposals-changed", refresh);
    return () => window.removeEventListener("ai-proposals-changed", refresh);
  }, []);

  if (!user) return null;
  const canSupervise = !!profile && profile.role !== "masters";

  const ICONS: Record<AccountLinkId, () => JSX.Element> = {
    projects: GridIcon,
    supervise: EyeIcon,
    shared: ShareIcon,
    "ai-review": () => <></>,
    settings: GearIcon,
    docs: HelpIcon,
    signout: LogoutIcon,
    signin: LogoutIcon,
  };
  const TITLES: Partial<Record<AccountLinkId, string>> = {
    projects: "Projects",
    supervise: "Supervisor view",
    shared: "Shared with me",
    "ai-review": "Review AI suggestions",
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
            {accountLinks({
        canSupervise,
        hasProject: !!current,
        pendingProposals,
        local,
        // Whether the routes exist here is a build fact, not a session one: the
        // desktop export does not contain `/supervision` or `/shared` even when
        // it is signed in. See `account-links.ts`.
        hasRoutes: !isOfflineBuild(),
      }).map((link) => {
        const Icon = ICONS[link.id];

        // Leaving offline mode is not signing out — there is no session to end.
        // It puts the sign-in screen back, and the local data stays where it is.
        if (link.id === "signin") {
          return (
            <button
              key={link.id}
              className="signout"
              onClick={() => {
                getContainer().auth.setLocalMode(false);
                window.location.reload();
              }}
              title="Sign in to sync this work with an account. What is on this computer stays here."
            >
              <Icon /><span>{link.label}</span>
            </button>
          );
        }
        if (link.id === "signout") {
          return (
            <button key={link.id} className="signout" onClick={() => void signOut()} title={user.email}>
              <Icon /><span>{link.label}</span>
            </button>
          );
        }
        if (link.id === "projects") {
          // Return to the project picker. ProjectSwitcher hides when no project
          // is selected, so without this there is no way back from account routes
          // (/settings, /shared, /supervision) once a project is deselected.
          return (
            <button
              key={link.id}
              type="button"
              className="header-link"
              title={TITLES[link.id]}
              onClick={() => {
                setProject(null);
                router.push("/dashboard");
                close();
              }}
            >
              <Icon /><span>{link.label}</span>
            </button>
          );
        }
        if (link.id === "ai-review") {
          return (
            <Link key={link.id} href={link.href!} className="header-link ai-review-nav-link" title={TITLES[link.id]} onClick={close}>
              <span>{link.label}</span><b>{link.badge}</b>
            </Link>
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
      ariaLabel="Account"
      triggerClassName="header-overflow-btn"
      label={<UserIcon />}
    >
      {links}
    </Popover>
  );
}
