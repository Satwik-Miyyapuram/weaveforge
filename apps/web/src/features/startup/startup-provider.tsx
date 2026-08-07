"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Member, OrgMembershipView, UserSettings } from "@weaveforge/core";
import type { AppContainer } from "@/bootstrap";
import { hasActiveLab, needsDisclaimerAcceptance, needsStandaloneRoleSync } from "@weaveforge/core";
import { continueStandalone, fetchMemberships } from "@/features/org/infrastructure/org-api";
import { singleFlight } from "@/lib/single-flight";

export interface StartupSnapshot {
  settings: UserSettings | null;
  profile: Member | null;
  team: Member[];
  labMembers: Member[];
  memberships: OrgMembershipView[];
  needsPrivacyAccept: boolean;
}

interface StartupState {
  /** True until the full org/profile bundle resolves. Drives ProfileProvider. */
  loading: boolean;
  /**
   * True once the disclaimer decision is known (from cache, or after the
   * settings read). The shell drops its full-screen loader on this — it does
   * not wait for `loading`, because screens do not need org/profile data to
   * render. Fail-closed: false until a concrete decision exists.
   */
  gateReady: boolean;
  /** The current disclaimer verdict; only meaningful once `gateReady`. */
  needsPrivacyAccept: boolean;
  snapshot: StartupSnapshot | null;
  refreshProfile: () => Promise<void>;
}

const StartupContext = createContext<StartupState | null>(null);

interface OrgBatch {
  profile: Member | null;
  team: Member[];
  labMembers: Member[];
  memberships: OrgMembershipView[];
}

/** The four org reads plus the project-list warm — one parallel round trip. */
async function loadOrgBatch(c: AppContainer): Promise<OrgBatch> {
  const [mine, members, lab, labs] = await Promise.all([
    c.org.loadProfile().catch(() => null),
    c.org.loadTeam().catch(() => [] as Member[]),
    c.org.loadLab().catch(() => [] as Member[]),
    fetchMemberships().catch(() => [] as OrgMembershipView[]),
    // Warm the project list in the same batch. ProjectProvider mounts below
    // every gate in the shell, so its own listProjects() would otherwise be a
    // further serial round trip after all of these — and nothing renders until
    // it resolves. The repository is cache-wrapped, so the provider's own call
    // hits a settled entry.
    c.projects.listProjects().catch(() => []),
  ]);

  let profile = mine;
  let team = members;
  let labMembers = lab;
  const inLab = hasActiveLab(profile?.activeOrgId, labs);
  if (needsStandaloneRoleSync(profile, labs, inLab)) {
    try {
      await continueStandalone();
      profile = await c.org.loadProfile();
      team = await c.org.loadTeam();
      labMembers = await c.org.loadLab();
    } catch {
      /* display layer still resolves standalone role */
    }
  }
  return { profile, team, labMembers, memberships: labs };
}

async function loadStartupBundleUncached(
  userId: string,
  opts?: {
    assumeAccepted?: boolean;
    /**
     * Fires the moment the disclaimer decision is known — before the org batch
     * resolves. Lets the shell drop its full-screen loader and mount the
     * screens (which have their own caches and loaders) while profile and org
     * data stream in behind them, instead of holding everything for the whole
     * bundle.
     */
    onDecision?: (needsPrivacyAccept: boolean, settings: UserSettings | null) => void;
  },
): Promise<StartupSnapshot> {
  void userId;
  const { getLightContainer } = await import("@/light-bootstrap");
  const light = getLightContainer();

  // Container graph (~17 JS chunks) depends on nothing here; load it now rather
  // than after the settings round trip so the browser is not idle through it.
  const containerPromise = import("@/bootstrap").then(({ ensureContainer }) => ensureContainer());

  const settingsPromise = light.settings.getMetadata().catch(() => null);

  // Only three things were ever serial on the critical path: auth, then
  // settings, then the org batch — settings gating the batch by the
  // fail-closed rule (no org probes until the disclaimer is accepted).
  //
  // When a cached snapshot already proves the disclaimer accepted *under the
  // current version* (`assumeAccepted`), that gate does not apply: acceptance
  // cannot silently reverse, and RLS scopes every org read to the signed-in
  // user regardless. So fire the batch in parallel with the settings recheck
  // and collapse the last serial hop. First-time users, and anyone whose cache
  // predates a disclaimer-version bump, have no proof and still wait.
  const speculativeBatch = opts?.assumeAccepted
    ? containerPromise.then(loadOrgBatch)
    : null;

  const settings = await settingsPromise;
  const needsPrivacyAccept = settings ? needsDisclaimerAcceptance(settings) : true;
  // The gate can decide now; the org batch below no longer blocks the shell.
  opts?.onDecision?.(needsPrivacyAccept, settings);

  if (needsPrivacyAccept) {
    void containerPromise.catch(() => undefined);
    // Discard any speculative batch — the fresh settings say re-accept first.
    void speculativeBatch?.catch(() => undefined);
    return {
      settings,
      profile: null,
      team: [],
      labMembers: [],
      memberships: [],
      needsPrivacyAccept: true,
    };
  }

  const batch = speculativeBatch ?? containerPromise.then(loadOrgBatch);
  const { profile, team, labMembers, memberships } = await batch;

  return {
    settings,
    profile,
    team,
    labMembers,
    memberships,
    needsPrivacyAccept: false,
  };
}

function loadStartupBundle(
  userId: string,
  opts?: Parameters<typeof loadStartupBundleUncached>[1],
): Promise<StartupSnapshot> {
  return singleFlight(`startup:${userId}`, () => loadStartupBundleUncached(userId, opts));
}

/**
 * Whether a cached snapshot proves the disclaimer accepted under the *current*
 * version. Re-evaluated against the running code, so a version bump in a new
 * deploy correctly withdraws the proof and makes the next boot gate again.
 */
function cacheProvesAccepted(cached: StartupSnapshot | null): boolean {
  return Boolean(cached && cached.settings && !needsDisclaimerAcceptance(cached.settings));
}

/** localStorage-backed snapshot cache so cold reopens paint without a loader. */
const STARTUP_CACHE_PREFIX = "thesis.startup.";

function readCachedSnapshot(userId: string): StartupSnapshot | null {
  try {
    const raw = localStorage.getItem(STARTUP_CACHE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as StartupSnapshot) : null;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(userId: string, snapshot: StartupSnapshot): void {
  try {
    localStorage.setItem(STARTUP_CACHE_PREFIX + userId, JSON.stringify(snapshot));
  } catch {
    /* best-effort */
  }
}

/** Parallel startup after auth; profile/org load waits until privacy disclaimer accepted. */
export function StartupProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<StartupSnapshot | null>(() => readCachedSnapshot(userId));
  // Instant paint is only safe for the disclaimer modal (light container). A
  // cached "already accepted" snapshot must not clear loading — shell children
  // call getContainer() sync, and ensureContainer runs inside loadStartupBundle.
  const [loading, setLoading] = useState(() => {
    const cached = readCachedSnapshot(userId);
    if (!cached) return true;
    return !cached.needsPrivacyAccept;
  });

  // The disclaimer decision, known independently of the org/profile tail. A
  // cached snapshot proves it synchronously; otherwise it lands after the
  // settings read. Fail-closed: unknown reads as "needs accept".
  const [gateReady, setGateReady] = useState(() => readCachedSnapshot(userId) != null);
  const [needsPrivacyAccept, setNeedsPrivacyAccept] = useState(() => {
    const cached = readCachedSnapshot(userId);
    // Re-evaluate against the running code, so a disclaimer-version bump in a
    // new deploy withdraws a stale "accepted" and re-gates.
    return cached?.settings ? needsDisclaimerAcceptance(cached.settings) : true;
  });

  const applyDecision = useCallback((needs: boolean) => {
    setNeedsPrivacyAccept(needs);
    setGateReady(true);
  }, []);

  const refreshProfile = useCallback(async () => {
    // A refresh follows an explicit accept, so acceptance is known — skip the
    // gate and go straight to the parallel batch.
    const next = await loadStartupBundle(userId, {
      assumeAccepted: cacheProvesAccepted(readCachedSnapshot(userId)),
      onDecision: applyDecision,
    });
    setSnapshot(next);
    writeCachedSnapshot(userId, next);
  }, [userId, applyDecision]);

  useEffect(() => {
    let active = true;
    const cached = readCachedSnapshot(userId);
    if (cached) {
      setSnapshot(cached);
      setLoading(!cached.needsPrivacyAccept);
    } else {
      setLoading(true);
    }
    void loadStartupBundle(userId, {
      assumeAccepted: cacheProvesAccepted(cached),
      onDecision: (needs) => {
        if (active) applyDecision(needs);
      },
    })
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        writeCachedSnapshot(userId, data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, applyDecision]);

  const value = useMemo(
    () => ({ loading, gateReady, needsPrivacyAccept, snapshot, refreshProfile }),
    [loading, gateReady, needsPrivacyAccept, snapshot, refreshProfile],
  );

  return <StartupContext.Provider value={value}>{children}</StartupContext.Provider>;
}

export function useStartup(): StartupState {
  const ctx = useContext(StartupContext);
  if (!ctx) throw new Error("useStartup must be used within StartupProvider");
  return ctx;
}

/** Optional hook for gates that mount before StartupProvider. */
export function useStartupOptional(): StartupState | null {
  return useContext(StartupContext);
}
