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
import type { Member, OrgMembershipView, UserSettings } from "@thesis/core";
import { hasActiveLab, needsDisclaimerAcceptance, needsStandaloneRoleSync } from "@thesis/core";
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
  loading: boolean;
  snapshot: StartupSnapshot | null;
  refreshProfile: () => Promise<void>;
}

const StartupContext = createContext<StartupState | null>(null);

async function loadStartupBundleUncached(userId: string): Promise<StartupSnapshot> {
  const { getLightContainer } = await import("@/light-bootstrap");
  const light = getLightContainer();

  // Start loading the container graph now, in parallel with the settings read.
  // It is ~17 JavaScript chunks and depends on nothing here, but it used to be
  // imported only *after* this round trip resolved — so the browser sat idle
  // through the query, then spent two seconds downloading JS. Constructing the
  // container performs no reads, so this is not a probe: the fail-closed rule
  // below still governs every query.
  const containerPromise = import("@/bootstrap").then(({ ensureContainer }) => ensureContainer());

  const settings = await light.settings.getMetadata().catch(() => null);
  const needsPrivacyAccept = settings ? needsDisclaimerAcceptance(settings) : true;

  // Fail closed: no profile/org/crypto probes until the disclaimer is accepted.
  if (needsPrivacyAccept) {
    // Keep the in-flight import from surfacing as an unhandled rejection.
    void containerPromise.catch(() => undefined);
    return {
      settings,
      profile: null,
      team: [],
      labMembers: [],
      memberships: [],
      needsPrivacyAccept: true,
    };
  }

  const c = await containerPromise;
  const [mine, members, lab, labs] = await Promise.all([
    c.org.loadProfile().catch(() => null),
    c.org.loadTeam().catch(() => [] as Member[]),
    c.org.loadLab().catch(() => [] as Member[]),
    fetchMemberships().catch(() => [] as OrgMembershipView[]),
    // Warm the project list in the same batch. ProjectProvider mounts below
    // every gate in the shell, so its own listProjects() was a further serial
    // round trip after all of these had already finished — and nothing renders
    // until it resolves, because the shell needs an active project. The
    // repository is cache-wrapped, so that call now hits a settled entry.
    c.projects.listProjects().catch(() => []),
  ]);

  let profile = mine;
  let team = members;
  let labMembers = lab;
  const memberships = labs;
  const inLab = hasActiveLab(profile?.activeOrgId, memberships);

  if (needsStandaloneRoleSync(profile, memberships, inLab)) {
    try {
      await continueStandalone();
      profile = await c.org.loadProfile();
      team = await c.org.loadTeam();
      labMembers = await c.org.loadLab();
    } catch {
      /* display layer still resolves standalone role */
    }
  }

  return {
    settings,
    profile,
    team,
    labMembers,
    memberships,
    needsPrivacyAccept: false,
  };
}

function loadStartupBundle(userId: string): Promise<StartupSnapshot> {
  return singleFlight(`startup:${userId}`, () => loadStartupBundleUncached(userId));
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

  const refreshProfile = useCallback(async () => {
    const next = await loadStartupBundle(userId);
    setSnapshot(next);
    writeCachedSnapshot(userId, next);
  }, [userId]);

  useEffect(() => {
    let active = true;
    const cached = readCachedSnapshot(userId);
    if (cached) {
      setSnapshot(cached);
      setLoading(!cached.needsPrivacyAccept);
    } else {
      setLoading(true);
    }
    void loadStartupBundle(userId)
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
  }, [userId]);

  const value = useMemo(
    () => ({ loading, snapshot, refreshProfile }),
    [loading, snapshot, refreshProfile],
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
