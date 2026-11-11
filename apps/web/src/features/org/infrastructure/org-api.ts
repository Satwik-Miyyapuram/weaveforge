import { authHeaders as bearerHeaders } from "@/lib/auth-headers";
import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { singleFlight } from "@/lib/cache/parts";
import { getDataClient, relayUrl } from "@/lib/parts";
import { readJsonBody, responseError } from "@/lib/format-error";
import { readyCore, typedCore } from "@/lib/rust-core";
import type { OrgInviteRole, OrgJoinSource, OrgMembershipView } from "@weaveforge/core";

// --- membership-row ---
/** The `org_memberships` columns both the client and the admin path select. */
export const MEMBERSHIP_ROW_COLUMNS = "org_id, role, joined_via, organizations(name)";

// --- org-api ---
const SERVICE_ROLE_HINT = "Lab create/join is not available on this deployment yet.";

/** Rust keeps role as String; this narrows it to OrgInviteRole. */
function toInviteRole(role: string): OrgInviteRole {
  return role as OrgInviteRole;
}

/** Rust keeps joinSource as String; it only emits invite, create or legacy. */
function toJoinSource(source: string): OrgJoinSource {
  return source as OrgJoinSource;
}

function toMembershipView(view: { orgId: string; orgName: string; role: string; joinSource: string }): OrgMembershipView {
  return { orgId: view.orgId, orgName: view.orgName, role: toInviteRole(view.role), joinSource: toJoinSource(view.joinSource) };
}

function orgApiError(res: Response, message: string | undefined, fallback: string): Error {
  if (message && readyCore().isMissingServiceRole(message)) {
    return new Error(SERVICE_ROLE_HINT);
  }
  return responseError(res, message, fallback);
}

/**
 * Read an org route's answer: throws the mapped error when it failed, else
 * returns its body. The status is checked before the body is trusted, so a
 * proxy's HTML error page reads as the failure it is, not as a JSON parse error.
 */
export async function orgResponse<T extends { error?: string }>(res: Response, fallback: string): Promise<T> {
  const body = (await readJsonBody(res)) as T;
  if (!res.ok) throw orgApiError(res, body.error, fallback);
  return body;
}

const authHeaders = () => bearerHeaders({ "Content-Type": "application/json" });

function migrationHint(message: string): Error {
  if (readyCore().needsMigrationHint(message)) {
    return new Error(
      "Database update required — apply the schema migrations (npm run migrate:schema, 0030–0034) and try again.",
    );
  }
  return new Error(message);
}

export async function createOrg(name: string) {
  const res = await fetch(relayUrl("/api/org/create"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  const body = await orgResponse<{ error?: string }>(res, "Failed to create lab.");
  invalidateAllRepoCaches();
  return body;
}

export async function joinOrg(input: {
  code: string;
  phdSupervisorId?: string;
  professorSupervisorId?: string;
}) {
  const res = await fetch(relayUrl("/api/org/join"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = await orgResponse<{ error?: string }>(res, "Failed to join lab.");
  invalidateAllRepoCaches();
  return body;
}

/** Marks org onboarding complete — anon key + RPC, no service role. */
export async function continueStandalone() {
  let rpcErr: { message?: string } | null = null;
  try {
    const db = getDataClient();
    const res = await db.rpc("complete_org_setup");
    rpcErr = res.error;
    if (rpcErr) {
      try {
        const { getLightContainer } = await import("@/light-bootstrap");
        await getLightContainer().selfProvisioner.ensureProvisioned();
        const retry = await db.rpc("complete_org_setup");
        rpcErr = retry.error;
      } catch {
        /* fallback below will handle */
      }
    }
  } catch (err) {
    rpcErr = err as Error;
  }

  if (!rpcErr) {
    invalidateAllRepoCaches();
    return;
  }

  const res = await fetch(relayUrl("/api/org/standalone"), {
    method: "POST",
    headers: await authHeaders(),
  });
  const body = (await readJsonBody(res)) as { error?: string };
  if (res.ok) {
    invalidateAllRepoCaches();
    return;
  }

  const message = body.error ?? rpcErr.message ?? "Failed to complete org setup.";
  throw migrationHint(message);
}

export async function previewOrgCode(code: string) {
  // The route reads the code as the signed-in user, so this needs the same
  // bearer every other org call sends. Without it the lookup came back "Not
  // authenticated", the supervisor pickers never rendered, and the join was
  // refused for a missing supervisor the form had no way to ask for.
  const res = await fetch(relayUrl(`/api/org/codes?code=${encodeURIComponent(code)}`), {
    headers: await authHeaders(),
  });
  const body = await orgResponse<{
    error?: string;
    orgName?: string;
    targetRole?: string;
    professors?: { id: string; label: string }[];
    phds?: { id: string; label: string }[];
  }>(res, "Invalid code.");
  return body;
}

export async function regenerateOrgCode(orgId: string, targetRole: string) {
  const res = await fetch(relayUrl("/api/org/codes"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ orgId, targetRole }),
  });
  const body = await orgResponse<{ error?: string; code?: string; targetRole?: string }>(res, "Failed to regenerate code.");
  return body;
}

export async function fetchOwnedOrgs() {
  const res = await fetch(relayUrl("/api/org/mine"), { headers: await authHeaders() });
  const body = await orgResponse<{
    error?: string;
    organizations?: { id: string; name: string; ownerId: string }[];
  }>(res, "Failed to load labs.");
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
  const db = getDataClient();
  const { data: session } = await db.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("Not authenticated.");

  const { data, error } = await db
    .from("org_memberships")
    .select(MEMBERSHIP_ROW_COLUMNS)
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  if (!error && data) return data.map((row) => toMembershipView(typedCore().membershipViewFromRow(row)));

  const res = await fetch(relayUrl("/api/org/memberships"), { headers: await authHeaders() });
  const body = await orgResponse<{
    error?: string;
    memberships?: OrgMembershipView[];
  }>(res, "Failed to load labs.");
  return body.memberships ?? [];
}

export async function switchOrg(orgId: string) {
  const db = getDataClient();
  const { error: rpcErr } = await db.rpc("switch_active_org", { p_org_id: orgId });
  if (!rpcErr) {
    invalidateAllRepoCaches();
    return;
  }

  const res = await fetch(relayUrl("/api/org/switch"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ orgId }),
  });
  const body = (await readJsonBody(res)) as { error?: string };
  if (res.ok) {
    invalidateAllRepoCaches();
    return;
  }

  const message = body.error ?? rpcErr.message;
  throw migrationHint(message);
}

/** Leave a lab — RPC first, service-role API fallback. */
export async function leaveOrg(orgId: string) {
  const db = getDataClient();
  const { error: rpcErr } = await db.rpc("leave_org", { p_org_id: orgId });
  if (!rpcErr) {
    invalidateAllRepoCaches();
    return;
  }

  const res = await fetch(relayUrl("/api/org/leave"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ orgId }),
  });
  const body = (await readJsonBody(res)) as { error?: string };
  if (res.ok) {
    invalidateAllRepoCaches();
    return;
  }

  const message = body.error ?? rpcErr.message;
  throw migrationHint(message);
}
