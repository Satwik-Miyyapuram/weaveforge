"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/features/org/ui/profile-provider";
import { useProject } from "@/features/projects";
import { getContainer } from "@/bootstrap";

const DOCS_URL = "https://docs.weaveforge.org/docs/";
const REPO_URL = "https://github.com/Satwik-Miyyapuram/weaveforge";

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
const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="action-icon" aria-hidden="true">
    <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58l-.01-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.21.69.82.57A12 12 0 0 0 12 .5Z" />
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
  const { setProject } = useProject();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingProposals, setPendingProposals] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

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

  const links = (
    <>
      <button type="button" className="header-link" title="Projects" onClick={goToProjects}>
        <GridIcon /><span>Projects</span>
      </button>
      {canSupervise && (
        <Link href="/supervision" className="header-link" title="Supervisor view" onClick={() => setOpen(false)}>
          <EyeIcon /><span>Supervise</span>
        </Link>
      )}
      <Link href="/shared" className="header-link" title="Shared with me" onClick={() => setOpen(false)}>
        <ShareIcon /><span>Shared</span>
      </Link>
      {pendingProposals > 0 && <Link href="/ai-review" className="header-link ai-review-nav-link" title="Review AI suggestions" onClick={() => setOpen(false)}>
        <span>Review AI</span><b>{pendingProposals}</b>
      </Link>}
      <Link href="/settings" className="header-link" title="Settings" onClick={() => setOpen(false)}>
        <GearIcon /><span>Settings</span>
      </Link>
      {/* Help sits with Settings rather than inside it: someone looking for the
          documentation is usually stuck, and asking them to find it under a
          settings page is asking them to search while stuck.

          Both are external, so both open in a new tab — losing unsaved work to
          a documentation link would be its own small betrayal. */}
      <a
        href={DOCS_URL}
        className="header-link"
        title="Documentation"
        target="_blank"
        rel="noreferrer"
        onClick={() => setOpen(false)}
      >
        <HelpIcon /><span>Help &amp; docs</span>
      </a>
      <a
        href={REPO_URL}
        className="header-link"
        title="Source on GitHub"
        target="_blank"
        rel="noreferrer"
        onClick={() => setOpen(false)}
      >
        <GitHubIcon /><span>GitHub</span>
      </a>
      <button className="signout" onClick={() => void signOut()} title={user.email}>
        <LogoutIcon /><span>Sign out</span>
      </button>
    </>
  );

  if (variant === "list") {
    return <div className="header-actions">{links}</div>;
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
