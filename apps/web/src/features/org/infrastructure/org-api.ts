import { getSupabase } from "@/lib/supabase";
import { authHeaders as bearerHeaders } from "@/lib/auth-headers";
import { singleFlight } from "@/lib/cache/single-flight";
import type { OrgInviteRole, OrgMembershipView } from "@weaveforge/core";

const SERVICE_ROLE_HINT = "Lab create/join is not available on this deployment yet.";

function orgApiError(message: string | undefined, fallback: string): Error {
  const text = message ?? fallback;
  if (text.includes("Missing Supabase service role")) {
    return new Error(SERVICE_ROLE_HINT);
  }
  return new Error(text);
}

const authHeaders = () => bearerHeaders({ "Content-Type": "application/json" });

function migrationHint(message: string): Error {
  if (
    message.includes("complete_org_setup") ||
    message.includes("switch_active_org") ||
    message.includes("Could not find the function")
  ) {
    return new Error(
      "Database update required — run supabase db push (migrations 0030–0034) and try again.",
    );
  }
  return new Error(message);
}

export async function createOrg(name: string) {
  const res = await fetch("/api/org/create", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw orgApiError(body.error, "Failed to create lab.");
  return body;
}

export async function joinOrg(input: {
  code: string;
  phdSupervisorId?: string;
  professorSupervisorId?: string;
}) {
  const res = await fetch("/api/org/join", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw orgApiError(body.error, "Failed to join lab.");
  return body;
}

/** Marks org onboarding complete — anon key + RPC, no service role. */
export async function continueStandalone() {
  const supabase = getSupabase();
  const { error: rpcErr } = await supabase.rpc("complete_org_setup");
  if (!rpcErr) return;

  const res = await fetch("/api/org/standalone", {
    method: "POST",
    headers: await authHeaders(),
  });
  const body = (await res.json()) as { error?: string };
  if (res.ok) return;

  const message = body.error ?? rpcErr.message;
  throw migrationHint(message);
}

export async function previewOrgCode(code: string) {
  const res = await fetch(`/api/org/codes?code=${encodeURIComponent(code)}`);
  const body = (await res.json()) as {
    error?: string;
    orgName?: string;
    targetRole?: string;
    professors?: { id: string; label: string }[];
    phds?: { id: string; label: string }[];
  };
  if (!res.ok) throw new Error(body.error ?? "Invalid code.");
  return body;
}

export async function regenerateOrgCode(orgId: string, targetRole: string) {
  const res = await fetch("/api/org/codes", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ orgId, targetRole }),
  });
  const body = (await res.json()) as { error?: string; code?: string; targetRole?: string };
  if (!res.ok) throw orgApiError(body.error, "Failed to regenerate code.");
  return body;
}

export async function fetchOwnedOrgs() {
  const res = await fetch("/api/org/mine", { headers: await authHeaders() });
  const body = (await res.json()) as {
    error?: string;
    organizations?: { id: string; name: string; ownerId: string }[];
  };
  if (!res.ok) throw orgApiError(body.error, "Failed to load labs.");
  return body.organizations ?? [];
}

/**
 * Labs the signed-in user belongs to (for the org switcher).
 *
 * Shared between concurrent callers: the startup bundle and `ProfileProvider`
 * both want it during boot, and the answer is the same row set either way.
 */
export function fetchMemberships(): Promise<OrgMembershipView[]> {
  return singleFlight("org:memberships", fetchMembershipsUncached);
}

async function fetchMembershipsUncached(): Promise<OrgMembershipView[]> {
  const supabase = getSupabase();
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("Not authenticated.");

  const { data, error } = await supabase
    .from("org_memberships")
    .select("org_id, role, joined_via, organizations(name)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  if (!error && data) {
    return data.map((row) => {
      const org = row.organizations as { name: string } | { name: string }[] | null;
      const name = Array.isArray(org) ? org[0]?.name : org?.name;
      const joinedVia = (row as { joined_via?: string }).joined_via;
      return {
        orgId: row.org_id as string,
        orgName: name ?? "Lab",
        role: row.role as OrgInviteRole,
        joinSource: joinedVia === "invite" || joinedVia === "create" ? joinedVia : "legacy",
      };
    });
  }

  const res = await fetch("/api/org/memberships", { headers: await authHeaders() });
  const body = (await res.json()) as {
    error?: string;
    memberships?: OrgMembershipView[];
  };
  if (!res.ok) throw orgApiError(body.error, "Failed to load labs.");
  return body.memberships ?? [];
}

export async function switchOrg(orgId: string) {
  const supabase = getSupabase();
  const { error: rpcErr } = await supabase.rpc("switch_active_org", { p_org_id: orgId });
  if (!rpcErr) return;

  const res = await fetch("/api/org/switch", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ orgId }),
  });
  const body = (await res.json()) as { error?: string };
  if (res.ok) return;

  const message = body.error ?? rpcErr.message;
  throw migrationHint(message);
}

/** Leave a lab — RPC first, service-role API fallback. */
export async function leaveOrg(orgId: string) {
  const supabase = getSupabase();
  const { error: rpcErr } = await supabase.rpc("leave_org", { p_org_id: orgId });
  if (!rpcErr) return;

  const res = await fetch("/api/org/leave", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ orgId }),
  });
  const body = (await res.json()) as { error?: string };
  if (res.ok) return;

  const message = body.error ?? rpcErr.message;
  throw migrationHint(message);
}
