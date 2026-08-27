"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/features/org/ui/profile-provider";
import { useProject } from "@/features/projects";
import { getContainer } from "@/bootstrap";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { accountLinks, type AccountLinkId } from "./account-links";
import { LocalModeBadge } from "@/features/auth/ui/local-mode-badge";
import { isLocalMode, setLocalMode } from "@/backend/providers/local/local-identity";


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
 *  - `variant="list"` (default, desktop sidebar): labelled links.
 *  - `variant="menu"` (compact top bar): a "⋯" button opening a dropdown, per
 *    the design's overflow menu.
 */
export function HeaderActions({ variant = "list" }: { variant?: "list" | "menu" }) {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { current, setProject } = useProject();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingProposals, setPendingProposals] = useState(0);
  const [local, setLocal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismissOnOutside(open, () => setOpen(false), ref);

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
    setLocal(isLocalMode());
    window.addEventListener("ai-proposals-changed", refresh);
    return () => window.removeEventListener("ai-proposals-changed", refresh);
  }, []);

  if (!user) return null;
  const canSupervise = !!profile && profile.role !== "masters";

  // Return to the project picker. ProjectSwitcher hides when no project is
  // selected, so without this there is no way back from account routes
  // (/settings, /shared, /supervision) once a project is deselected.
  const goToProjects = () => {
    setProject(null);
    router.push("/dashboard");
    setOpen(false);
  };

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

  // Rendered from `accountLinks`, so which entries exist — and which
  // deliberately do not — is decided in one tested place rather than in JSX.
  const links = (
    <>
      {accountLinks({ canSupervise, hasProject: !!current, pendingProposals, local }).map((link) => {
        const Icon = ICONS[link.id];

        // Leaving offline mode is not signing out — there is no session to end.
        // It puts the sign-in screen back, and the local data stays where it is.
        if (link.id === "signin") {
          return (
            <button
              key={link.id}
              className="signout"
              onClick={() => {
                setLocalMode(false);
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
          return (
            <button key={link.id} type="button" className="header-link" title={TITLES[link.id]} onClick={goToProjects}>
              <Icon /><span>{link.label}</span>
            </button>
          );
        }
        if (link.id === "ai-review") {
          return (
            <Link key={link.id} href={link.href!} className="header-link ai-review-nav-link" title={TITLES[link.id]} onClick={() => setOpen(false)}>
              <span>{link.label}</span><b>{link.badge}</b>
            </Link>
          );
        }
        // External links open in a new tab — losing unsaved work to a
        // documentation link would be its own small betrayal.
        if (link.external) {
          return (
            <a key={link.id} href={link.href} className="header-link" title={TITLES[link.id]} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              <Icon /><span>{link.label}</span>
            </a>
          );
        }
        return (
          <Link key={link.id} href={link.href!} className="header-link" title={TITLES[link.id]} onClick={() => setOpen(false)}>
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
        {links}
      </div>
    );
  }

  return (
    <div className="header-overflow" ref={ref}>
      <button
        type="button"
        className="header-overflow-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && <div className="header-menu" role="menu">{links}</div>}
    </div>
  );
}
