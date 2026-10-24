"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Member, OrgMembershipView } from "@weaveforge/core";
import { useAuth } from "@/features/auth";
import { useStartupOptional } from "@/features/startup";
import { continueStandalone, fetchMemberships, switchOrg as switchActiveOrg } from "../infrastructure/org-api";
import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { shouldSyncStandalone } from "../application/org-profile-state";

const EMPTY_PROFILE_STATE = {
  profile: null as Member | null,
  team: [] as Member[],
  labMembers: [] as Member[],
  memberships: [] as OrgMembershipView[],
};

interface ProfileState {
  /** The signed-in user's member record (role + place in the tree). */
  profile: Member | null;
  /** Everyone the user may see: themselves + supervisees (transitively). */
  team: Member[];
  /** Full active-lab roster for the org chart (includes supervisors). */
  labMembers: Member[];
  /** Labs the user belongs to (empty when standalone). */
  memberships: OrgMembershipView[];
  /** Active lab from profiles.active_org_id. */
  activeOrgId: string | null;
  loading: boolean;
  /** Set when the last load failed; the state above is then the previous one. */
  error: string | null;
  refresh: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
}

const Ctx = createContext<ProfileState | null>(null);

/**
 * Loads the current member profile + visible team once signed in, so the UI can
 * gate account-creation affordances by role and label projects by owner. Access
 * to the org service goes through the container (composition root).
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const startup = useStartupOptional();
  const [profile, setProfile] = useState<Member | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [labMembers, setLabMembers] = useState<Member[]>([]);
  const [memberships, setMemberships] = useState<OrgMembershipView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const userId = user?.id;
    if (!userId) {
      setProfile(null);
      setTeam([]);
      setLabMembers([]);
      setMemberships([]);
      setError(null);
      return;
    }
    try {
      invalidateAllRepoCaches();
      if (startup?.refreshProfile) {
        await startup.refreshProfile().catch(() => undefined);
      }
      const { ensureContainer } = await import("@/bootstrap");
      const org = (await ensureContainer()).org;
      const [mine, members, lab, labs] = await Promise.all([
        org.loadProfile(),
        org.loadTeam(),
        org.loadLab(),
        // null, not []: a failed read is not "no labs" (see shouldSyncStandalone).
        fetchMemberships().catch((err: unknown) => {
          logToApp({ level: "warn", source: "profile", message: "Memberships did not load.", detail: formatError(err) });
          return null;
        }),
      ]);

      let profile = mine;
      let team = members;
      let labRoster = lab;
      if (shouldSyncStandalone(profile, labs)) {
        try {
          await continueStandalone();
          invalidateAllRepoCaches();
          profile = await org.loadProfile();
          team = await org.loadTeam();
          labRoster = await org.loadLab();
        } catch {
          /* display layer still resolves standalone role */
        }
      }

      setProfile(profile);
      setTeam(team);
      setLabMembers(labRoster);
      if (labs) setMemberships(labs);
      setError(null);
    } catch (err) {
      // Keep what was shown: a transient failure is not "no profile", which
      // would put an existing lab member on the setup screen.
      const message = formatError(err);
      logToApp({ level: "error", source: "profile", message: "Profile did not load.", detail: message });
      setError(message);
    }
  }, [user?.id, startup]);

  const switchOrg = useCallback(
    async (orgId: string) => {
      await switchActiveOrg(orgId);
      await refresh();
    },
    [refresh],
  );

  const startupPresent = startup != null;
  const startupLoading = startup?.loading ?? false;

  useEffect(() => {
    let active = true;
    const snap = startup?.snapshot;
    // StartupProvider owns the initial org load; duplicating it here doubles
    // every profiles/org_memberships round trip on boot.
    if (startupPresent && startupLoading) {
      setLoading(true);
      return () => {
        active = false;
      };
    }
    if (snap && !startupLoading) {
      setProfile(snap.profile);
      setTeam(snap.team);
      setLabMembers(snap.labMembers);
      setMemberships(snap.memberships);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setProfile(EMPTY_PROFILE_STATE.profile);
    setTeam(EMPTY_PROFILE_STATE.team);
    setLabMembers(EMPTY_PROFILE_STATE.labMembers);
    setMemberships(EMPTY_PROFILE_STATE.memberships);
    void refresh().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refresh, startupPresent, startupLoading, startup?.snapshot]);

  return (
    <Ctx.Provider
      value={{
        profile,
        team,
        labMembers,
        memberships,
        activeOrgId: profile?.activeOrgId ?? null,
        loading,
        error,
        refresh,
        switchOrg,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useProfile(): ProfileState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProfile must be used within a ProfileProvider.");
  return c;
}
