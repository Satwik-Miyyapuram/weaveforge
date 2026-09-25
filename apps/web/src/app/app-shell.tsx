"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

import { useAuth } from "@/features/auth/ui/auth-provider";
import { LoginScreen } from "@/features/auth/ui/login-screen";
import { ThesisLoaderScreen } from "@/components/weaveforge-loader";
import { ProjectProvider, ProjectSwitcher, ProjectsScreen, useProject } from "@/features/projects";
import { ProfileProvider, OrgSwitcher } from "@/features/org";
import { PrivacyDisclaimerGate } from "@/features/auth/ui/privacy-disclaimer-gate";
import { ThemeSyncProvider } from "@/features/settings/ui/theme-sync-provider";
import { OrgSetupGate } from "@/features/org/ui/org-setup-gate";
import { useLayoutBreakpoint } from "@/lib/hooks/use-layout-breakpoint";
import { useIsDetailView } from "@/lib/hooks/use-detail-view";
import { useWorkspaceRoute } from "@/lib/hooks/use-workspace-route";
import { useModuleRegistry } from "@/lib/hooks/use-nav-groups";
import { titleForPath } from "@/lib/route-title";
import { HeaderActions } from "./header-actions";
import { TabBar } from "./tabbar";
import { SubNav } from "./sub-nav";
import { PageTransition } from "./page-transition";
import { JumpToPalette } from "@/components/jump-to-palette";
import { NavPendingProvider } from "@/lib/nav-pending";
import { ShareDialogHost } from "@/features/sharing/ui/share-dialog-host";
import { RoutePending } from "./route-pending";
import { SwipeViews } from "./swipe-views";
import { StartupProvider } from "@/features/startup";
import { EmailRecoveryScreen } from "@/components/email-recovery-screen";
import { PasswordResetScreen } from "@/components/password-reset-screen";

/* Both paint nothing and only matter once a folder is connected; the folder
   code they carry is loaded after the page rather than with every one. */
const WorkspaceFolderRestore = dynamic(
  () => import("@/features/workspace/ui/workspace-folder-restore").then((m) => m.WorkspaceFolderRestore),
  { ssr: false },
);
const PdfTextFolderSync = dynamic(
  () => import("@/features/workspace/ui/pdf-text-folder-sync").then((m) => m.PdfTextFolderSync),
  { ssr: false },
);

/**
 * Top-level shell: gates on auth, then on a selected project. Brand header
 * carries the project switcher + account actions. Screen content is keyed by
 * the current project id so switching projects remounts (and reloads) screens.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, expired } = useAuth();
  const pathname = usePathname();
  if (pathname === "/recover") return <EmailRecoveryScreen />;
  if (pathname === "/reset-password") return <PasswordResetScreen />;
  // The product pitch is public and renders its own chrome: no auth gate, no
  // project gate, no nav. It sits inside the app rather than beside it so the
  // cards it shows are the app's real components, not a copy that drifts.
  if (pathname === "/pitch") return <>{children}</>;
  if (loading) return <ThesisLoaderScreen />;
  if (!user) return <main className="app-shell"><LoginScreen /></main>;
  return (
    <StartupProvider userId={user.id}>
        <PrivacyDisclaimerGate>
          <ProfileProvider key={user.id}>
            {/* E2EE unlock gate removed: data is stored plaintext, so the shell
                renders straight through after auth. */}
            <ThemeSyncProvider>
              <OrgSetupGate>
                {/* Above the project-scoped shell, so it runs once: the folder
                    mirror is per session, and reconnecting it per project would
                    re-ask on every switch. See the component for why this is
                    not in the Settings panel. */}
                <WorkspaceFolderRestore />
                {expired && <SessionExpiredPrompt />}
                <ProjectProvider>
                  <PdfTextFolderSync />
                  <ProjectScopedShell>{children}</ProjectScopedShell>
                </ProjectProvider>
              </OrgSetupGate>
            </ThemeSyncProvider>
          </ProfileProvider>
        </PrivacyDisclaimerGate>
    </StartupProvider>
  );
}

/**
 * Routes that belong to the account, not to a project. Without this the shell
 * falls back to the project picker for every route when nothing is selected, so
 * Settings / Supervise / Shared are reachable only after picking a project —
 * even though the links point straight at them and the URL updates correctly.
 */
const ACCOUNT_ROUTES = ["/settings", "/supervision", "/shared"];

function isAccountRoute(pathname: string): boolean {
  return ACCOUNT_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function ProjectScopedShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const linkRedeem = pathname === "/link" || pathname.startsWith("/link/");
  const { current } = useProject();
  const accountRoute = isAccountRoute(pathname);
  const registry = useModuleRegistry();
  // The window title names the screen, so the taskbar, history and a screen
  // reader's page announcement say where you are rather than "WeaveForge".
  useEffect(() => {
    const items = [registry.homeNavItem, ...registry.allModules.flatMap((m) => m.navItems)];
    document.title = titleForPath(pathname, items);
  }, [pathname, registry]);
  const { breakpoint, navEnter, railByDefault } = useLayoutBreakpoint();
  const detailView = useIsDetailView();
  // On `/workspace` the shell changes shape: the primary nav is always the icon
  // rail, the content is full-bleed and the sub-nav strip is gone (document
  // tabs supersede it). It is the one screen that is a workspace rather than a
  // page, and the only one that must reach the window's bottom edge.
  const editorRoute = useWorkspaceRoute();
  // The route picks the default and the hamburger overrides it: the rail on
  // `/workspace`, the wide sidebar elsewhere, either way until the person
  // toggles. `null` is "no override", and a route change clears it, so the
  // workspace collapses again on the way back in. It used to be
  // `editorRoute || manual`, which made the hamburger a dead button on the
  // one screen where the sidebar is narrowest.
  //
  // `railByDefault` joins the default for the same reason `/workspace` is in it:
  // between the 900px layout breakpoint and 1100px a 216px sidebar is a quarter
  // of the window, and both those widths are real tablets in landscape. It is a
  // *default*, not a rule — the toggle above still wins, and widening the window
  // past the threshold puts the sidebar back on its own.
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? (editorRoute || railByDefault);
  useEffect(() => setOverride(null), [editorRoute]);
  // Enable sidebar transitions only AFTER the layout has settled into place, so
  // the nav appearing on load (padding-left 0→232) doesn't slide the content
  // around. Collapse-toggle animations still play once this is on.
  const [anim, setAnim] = useState(false);

  // Deliberately does NOT warm every list for the project.
  //
  // It used to: ten tables — papers, notes, pins, logs, sections, lists, the
  // relation graph, experiments, milestones, tags — on every page load, whatever
  // screen the user was on. That is what made a single screen cost ~30 requests.
  // Screens load their own data, `prefetchScreenForPath` warms the next one on
  // tab hover, and the screen cache (memory + IndexedDB) keeps a revisit free,
  // so the blanket read bought a first-visit head start the other three
  // mechanisms already cover.
  useEffect(() => {
    if (!current) return;
    const projectId = current.id;
    let cancelled = false;
    void import("@/bootstrap").then(async ({ ensureContainer, getContainer }) => {
      await ensureContainer();
      if (cancelled) return;
      const ctx = getContainer().projects.context;
      if (ctx.projectId !== projectId) return;
      // Browser-triggered citation alerts: at most once per tracked paper/day.
      // Use-case also aborts writes if projectId changes mid-poll.
      void getContainer().papers.checkCitationAlerts().catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [current]);

  useEffect(() => {
    if (!current || anim) return;
    const id = requestAnimationFrame(() => setAnim(true));
    return () => cancelAnimationFrame(id);
  }, [current, anim]);

  if (linkRedeem) {
    return <>{children}</>;
  }

  const shell = (
    <div
      className={`layout layout--${breakpoint} ${current ? "has-nav" : ""} ${anim ? "anim" : ""} ${
        collapsed ? "nav-collapsed" : ""
      } ${editorRoute ? "editor-route" : ""}`.replace(/\s+/g, " ").trim()}
    >
      {/* First focusable thing in the shell. The primary nav renders above
          `<main>` and is a nine-item sidebar on desktop, so without this a
          keyboard user tabs the whole navigation on every route before reaching
          content. Hidden until focused; `base.css` already draws the ring. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {current && (
        <TabBar
          collapsed={collapsed}
          navEnter={navEnter}
          breakpoint={breakpoint}
          onToggle={() => setOverride(!collapsed)}
        />
      )}
      <main id="main" className="app-shell">
        <JumpToPalette />
        {/* Mobile's home for the account controls; on desktop they live in the
            nav. Rendered for one breakpoint only — mounting both and hiding one
            with CSS gave every switcher a second copy holding its own state. */}
        {breakpoint === "mobile" && !detailView && (
          <div className="brand mobile-only">
            <OrgSwitcher />
            <ProjectSwitcher />
            <div className="brand-right">
              <HeaderActions variant="menu" />
            </div>
          </div>
        )}
        {current ? (
          <div className="view-scope">
            {/* Detail views (a single paper/note/experiment) carry their own
                header and Back control, so the sub-tab strip and the
                swipe-between-tabs gesture are hidden and disabled there. */}
            {/* The workspace hides it too — document tabs supersede the
                Library strip there, and the rail keeps the rest one click
                away. */}
            {/* Mobile only. On a desktop the sidebar lists every destination
                itself, so a second row of the same links across the top of the
                content is chrome that says nothing new — and it was the row
                that made the Library look like six tabs rather than one section
                of a sidebar. */}
            {!detailView && !editorRoute && breakpoint === "mobile" && <SubNav />}
            <SwipeViews disabled={detailView || editorRoute}>
              <RoutePending>
                <PageTransition>{children}</PageTransition>
              </RoutePending>
            </SwipeViews>
          </div>
        ) : accountRoute ? (
          // No project, but this route does not need one. Rendered bare: SubNav,
          // SwipeViews and RoutePending are all project-view chrome, and
          // RoutePending drives nav-pending state that only makes sense there.
          <>
            <div className="project-picker-bar desktop-only">
              <HeaderActions variant="menu" />
            </div>
            {children}
          </>
        ) : (
          <>
            <div className="project-picker-bar desktop-only">
              <HeaderActions variant="menu" />
            </div>
            <ProjectsScreen />
          </>
        )}
      </main>
    </div>
  );

  if (current) {
    return (
      <NavPendingProvider>
        <ShareDialogHost>{shell}</ShareDialogHost>
      </NavPendingProvider>
    );
  }
  return <ShareDialogHost>{shell}</ShareDialogHost>;
}

/**
 * The session lapsed while the app was open. The workspace and its folder stay
 * where they are; this asks for a fresh sign-in on top of them, and signing in
 * as the same person picks up exactly where they were.
 */
function SessionExpiredPrompt() {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="session-expired-overlay" role="dialog" aria-modal="true" aria-label="Sign in again">
        <button type="button" className="session-expired-close" onClick={() => setOpen(false)} aria-label="Not now">×</button>
        <LoginScreen />
      </div>
    );
  }
  return (
    <div className="session-expired-banner" role="status">
      <span>Your session ended. Your workspace folder is still connected — sign in again to sync.</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>Sign in</button>
    </div>
  );
}
