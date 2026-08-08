"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/features/auth/ui/auth-provider";
import { LoginScreen } from "@/features/auth/ui/login-screen";
import { ThesisLoaderScreen } from "@/components/weaveforge-loader";
import { ProjectProvider, ProjectSwitcher, ProjectsScreen, useProject } from "@/features/projects";
import { ProfileProvider, OrgSwitcher } from "@/features/org";
import { PrivacyDisclaimerGate } from "@/features/auth/ui/privacy-disclaimer-gate";
import { ThemeSyncProvider } from "@/features/settings/ui/theme-sync-provider";
import { OrgSetupGate } from "@/features/org/ui/org-setup-gate";
import { useLayoutBreakpoint } from "@/lib/use-layout-breakpoint";
import { useIsDetailView } from "@/lib/use-detail-view";
import { HeaderActions } from "./header-actions";
import { ThemeToggle } from "./theme-toggle";
import { TabBar } from "./tabbar";
import { SubNav } from "./sub-nav";
import { PageTransition } from "./page-transition";
import { JumpToPalette } from "@/components/jump-to-palette";
import { NavPendingProvider } from "@/lib/nav-pending";
import { RoutePending } from "./route-pending";
import { SwipeViews } from "./swipe-views";
import { StartupProvider } from "@/features/startup";
import { EmailRecoveryScreen } from "@/components/email-recovery-screen";
import { PasswordResetScreen } from "@/components/password-reset-screen";

/**
 * Top-level shell: gates on auth, then on a selected project. Brand header
 * carries the project switcher + account actions. Screen content is keyed by
 * the current project id so switching projects remounts (and reloads) screens.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
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
                <ProjectProvider>
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
  const { breakpoint, navEnter } = useLayoutBreakpoint();
  const detailView = useIsDetailView();
  const [collapsed, setCollapsed] = useState(false);
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
      }`.replace(/\s+/g, " ").trim()}
    >
      {current && (
        <TabBar
          collapsed={collapsed}
          navEnter={navEnter}
          breakpoint={breakpoint}
          onToggle={() => setCollapsed(!collapsed)}
        />
      )}
      <main className="app-shell">
        <JumpToPalette />
        {/* Mobile's home for the account controls; on desktop they live in the
            nav. Rendered for one breakpoint only — mounting both and hiding one
            with CSS gave every switcher a second copy holding its own state. */}
        {breakpoint === "mobile" && !detailView && (
          <div className="brand mobile-only">
            <OrgSwitcher />
            <ProjectSwitcher />
            <div className="brand-right">
              <ThemeToggle />
              <HeaderActions variant="menu" />
            </div>
          </div>
        )}
        {current ? (
          <div className="view-scope">
            {/* Detail views (a single paper/note/experiment) carry their own
                header and Back control, so the sub-tab strip and the
                swipe-between-tabs gesture are hidden and disabled there. */}
            {!detailView && <SubNav />}
            <SwipeViews disabled={detailView}>
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
              <ThemeToggle />
              <HeaderActions variant="menu" />
            </div>
            {children}
          </>
        ) : (
          <>
            <div className="project-picker-bar desktop-only">
              <ThemeToggle />
              <HeaderActions variant="menu" />
            </div>
            <ProjectsScreen />
          </>
        )}
      </main>
    </div>
  );

  if (current) {
    return <NavPendingProvider>{shell}</NavPendingProvider>;
  }
  return shell;
}
