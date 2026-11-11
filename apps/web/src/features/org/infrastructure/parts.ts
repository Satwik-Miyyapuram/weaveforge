import {
  ProjectScopedPostgrestRepository,
} from "@/backend/providers/postgrest/project-scoped-repository";
import { one, oneRow, rows, run } from "@/backend/providers/postgrest/row-access";
import {
  milestoneColumns,
  type MilestoneRow,
  milestoneToDomain,
} from "@/features/plan/infrastructure/milestone-rows";
import { authHeaders as bearerHeaders } from "@/lib/auth-headers";
import { singleFlight } from "@/lib/cache/parts";
import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { readJsonBody, responseError } from "@/lib/format-error";
import { getDataClient, relayUrl } from "@/lib/parts";
import { readyCore, typedCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ILabSnapshotRepository,
  ISupervisionRepository,
  LabSnapshot,
  LabSnapshotContent,
  LogEntry,
  Milestone,
  OrgInviteRole,
  OrgJoinSource,
  OrgMembershipView,
  PublishLabSnapshotInput,
} from "@weaveforge/core";
import type { LogEntryRow } from "@weaveforge/wasm";

// --- org-api ---
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

// --- postgrest-lab-snapshot-repository ---
// --- lab-snapshot-rows ---
/**
 * How lab snapshot rows are stored. The mapping to the domain type is in Rust (wf-core).
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface LabSnapshotRow {
  id: string;
  project_id: string;
  title: string;
  note: string | null;
  content: LabSnapshotContent;
  published_at: string;
  created_at: string;
}

// --- postgrest-lab-snapshot-repository ---
/**
 * The columns a LabSnapshotRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const LAB_SNAPSHOT_COLUMNS = "id,project_id,title,note,content,published_at,created_at";

const TABLE = "lab_snapshots";

/** Bindings type f64 as number | null (NaN/Infinity serialise as null); values are always finite. */
const toFinite = (n: number | null): number => n as number;

/** Rust's nullable fields arrive as null; the domain leaves them absent. */
const toDomain = (row: LabSnapshotRow): LabSnapshot => {
  const s = readyCore().labSnapshotRowToDomain(row);
  const c = s.content;
  return {
    id: s.id,
    projectId: s.projectId,
    title: s.title,
    note: s.note ?? undefined,
    content: {
      milestones: c.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description ?? undefined,
        status: m.status,
        targetDate: m.targetDate ?? undefined,
      })),
      logs: c.logs,
      experiments: c.experiments?.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        resultNote: e.resultNote ?? undefined,
      })),
      report: c.report?.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        wordCount: toFinite(r.wordCount),
      })),
      aiAssisted: c.aiAssisted ?? undefined,
    },
    publishedAt: s.publishedAt,
    createdAt: s.createdAt,
  };
};

/**
 * The snapshot title rule is Rust (wf-core `lab_snapshot`). Its rejection
 * arrives as a thrown string, so it is rethrown as an Error for the UI.
 */
function snapshotTitle(raw: string): string {
  try {
    return readyCore().validateSnapshotTitle(raw);
  } catch (error) {
    if (typeof error === "string") throw new Error(error);
    throw error;
  }
}

export class PostgrestLabSnapshotRepository extends ProjectScopedPostgrestRepository implements ILabSnapshotRepository {
  protected readonly action = "publishing a lab snapshot";

  async publish(input: PublishLabSnapshotInput): Promise<LabSnapshot> {
    const title = snapshotTitle(input.title);
    const userId = await this.session.requireUserId();
    const dbRow = await oneRow<LabSnapshotRow>(this.db
      .from(TABLE)
      .insert({
        user_id: userId,
        project_id: this.projectId,
        title,
        note: input.note?.trim() || null,
        content: input.content,
      })
      .select(LAB_SNAPSHOT_COLUMNS)
      .single());
    return toDomain(dbRow);
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }

  async listMine(): Promise<LabSnapshot[]> {
    const userId = await this.session.requireUserId();
    return (await rows<LabSnapshotRow>(this.db
      .from(TABLE)
      .select(LAB_SNAPSHOT_COLUMNS)
      .eq("user_id", userId)
      .order("published_at", { ascending: false }))).map(toDomain);
  }

  async listForMember(memberId: string): Promise<LabSnapshot[]> {
    return (await rows<LabSnapshotRow>(this.db
      .from(TABLE)
      .select(LAB_SNAPSHOT_COLUMNS)
      .eq("user_id", memberId)
      .order("published_at", { ascending: false }))).map(toDomain);
  }

  async getById(id: string): Promise<LabSnapshot | null> {
    const row = await one<LabSnapshotRow>(this.db.from(TABLE).select(LAB_SNAPSHOT_COLUMNS).eq("id", id).maybeSingle());
    return row ? toDomain(row) : null;
  }
}

// --- postgrest-supervision-repository ---
// Log-entry row mapping runs in the Rust core (wf-core `logbook::log_entry_row`).
const logToDomain = (row: LogEntryRow) => typedCore().logEntryToDomain(row);

/**
 * Reads a supervisee's milestones and log entries by owner user id, across all
 * of their projects. Not project-scoped (a supervisor doesn't select the
 * student's project) — row-level security restricts results to members in the
 * caller's subtree, and the explicit `user_id` filter narrows to one person.
 */
export class PostgrestSupervisionRepository implements ISupervisionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listMilestones(memberId: string): Promise<Milestone[]> {
    return (await rows<MilestoneRow>(this.db
      .from("milestones")
      .select(milestoneColumns())
      .eq("user_id", memberId)
      .order("target_date", { ascending: true, nullsFirst: false }))).map(milestoneToDomain);
  }

  async listLogs(memberId: string): Promise<LogEntry[]> {
    return (await rows<LogEntryRow>(this.db
      .from("log_entries")
      .select(LOG_ENTRY_COLUMNS)
      .eq("user_id", memberId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }))).map(logToDomain);
  }

  async listMilestonesFor(memberIds: readonly string[]): Promise<Map<string, Milestone[]>> {
    if (memberIds.length === 0) return new Map();
    const { data, error } = await this.db
      .from("milestones")
      .select(`${milestoneColumns()},user_id`)
      .in("user_id", memberIds)
      .order("target_date", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return groupByOwner(data as unknown as (MilestoneRow & { user_id: string })[], memberIds, milestoneToDomain);
  }

  async listLogsFor(memberIds: readonly string[]): Promise<Map<string, LogEntry[]>> {
    if (memberIds.length === 0) return new Map();
    const { data, error } = await this.db
      .from("log_entries")
      .select(`${LOG_ENTRY_COLUMNS},user_id`)
      .in("user_id", memberIds)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return groupByOwner(data as (LogEntryRow & { user_id: string })[], memberIds, logToDomain);
  }
}

/**
 * The columns a LogEntryRow is read as, named rather than starred.
 *
 * Derived from the row type: exactly the fields the mapper reads, where a star
 * would mean "whatever the table grows next".
 */
const LOG_ENTRY_COLUMNS = "id,entry_date,kind,body,links,created_at";

/**
 * Split rows back out by owner, preserving the order the database returned.
 *
 * Every requested id gets an entry, empty or not: a supervisee with no logs has
 * to read as "nothing yet", not as "not loaded".
 */
function groupByOwner<Row extends { user_id: string }, T>(
  rows: readonly Row[],
  memberIds: readonly string[],
  toDomain: (row: Row) => T,
): Map<string, T[]> {
  const byOwner = new Map<string, T[]>(memberIds.map((id) => [id, []]));
  for (const row of rows) byOwner.get(row.user_id)?.push(toDomain(row));
  return byOwner;
}
