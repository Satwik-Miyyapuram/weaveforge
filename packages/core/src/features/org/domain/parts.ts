import { NotFoundError, PermissionError, ValidationError } from "../../../shared/errors.js";
import type { Identifiable } from "../../../shared/parts.js";
import type { ExperimentStatus } from "../../experiments/domain/parts.js";
import type { LogEntry, LogKind } from "../../logbook/domain/parts.js";
import type { Milestone, MilestoneStatus } from "../../plan/domain/parts.js";
import type { ReportStatus } from "../../report/domain/parts.js";

// --- parts ---
// --- account-provisioner ---
/**
 * Contract for provisioning new accounts (DIP).
 *
 * Creating an auth account requires privileged (service-role) access, which the
 * browser must never hold. The concrete implementation therefore delegates to a
 * trusted server endpoint; the domain/use-case layer depends only on this
 * interface. Swapping the transport (HTTP route, RPC, admin SDK) touches only
 * the adapter.
 */
export interface IAccountProvisioner {
  /**
   * Create an auth account + member record. The server independently
   * re-validates that the caller is allowed to create the requested role.
   */
  createMember(input: NewMemberInput): Promise<Member>;
}

// --- invite-code ---
/**
 * Org invite roles and the invite error type. The invite-code rules (Crockford
 * base32 format, typo-tolerant normalization, join assignment) are Rust, in
 * wf-core `org`.
 */
export const ORG_INVITE_ROLES = ["professor", "phd", "masters"] as const;

export type OrgInviteRole = (typeof ORG_INVITE_ROLES)[number];

export class OrgInviteValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "OrgInviteValidationError";
  }
}

// --- lab-snapshot ---
/** Types for lab-snapshot. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/** Frozen milestone fields included in a lab snapshot payload. */
export interface LabSnapshotMilestone {
  id: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  targetDate?: string;
}

/** Frozen log entry fields included in a lab snapshot payload. */
export interface LabSnapshotLog {
  id: string;
  entryDate: string;
  kind: LogKind;
  body: string;
}

/** Frozen experiment fields included in a lab snapshot payload. */
export interface LabSnapshotExperiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  resultNote?: string;
}

/** Frozen report section progress included in a lab snapshot payload. */
export interface LabSnapshotReportSection {
  id: string;
  title: string;
  status: ReportStatus;
  wordCount: number;
}

/** Snapshots published before experiments, report and AI counts existed lack those fields. */
export interface LabSnapshotContent {
  milestones: LabSnapshotMilestone[];
  logs: LabSnapshotLog[];
  experiments?: LabSnapshotExperiment[];
  report?: LabSnapshotReportSection[];
  /** AI suggestions the student accepted in this project. */
  aiAssisted?: number;
}

/** A published freeze of a project's plan + logbook for supervisor review. */
export interface LabSnapshot extends Identifiable {
  id: string;
  projectId: string;
  title: string;
  note?: string;
  content: LabSnapshotContent;
  publishedAt: string;
  createdAt: string;
}

export interface PublishLabSnapshotInput {
  title: string;
  note?: string;
  content: LabSnapshotContent;
}

// --- lab-snapshot-repository ---
export interface ILabSnapshotRepository {
  publish(input: PublishLabSnapshotInput): Promise<LabSnapshot>;
  remove(id: string): Promise<void>;
  listMine(): Promise<LabSnapshot[]>;
  /** Snapshots owned by `memberId` (supervisor read via RLS). */
  listForMember(memberId: string): Promise<LabSnapshot[]>;
  getById(id: string): Promise<LabSnapshot | null>;
}

// --- member-repository ---
/**
 * Repository contract for organization members (DIP).
 *
 * Reads are auth-context dependent (they answer "who am I" and "who is on my
 * team") rather than id-keyed CRUD, so the interface is intentionally narrow —
 * account creation goes through {@link IAccountProvisioner}, not `save`.
 */
export interface IMemberRepository {
  /** The signed-in user's own member record, or null if none exists yet. */
  getMine(): Promise<Member | null>;
  /**
   * Every member the signed-in user is allowed to see: themselves plus all of
   * their supervisees (transitively). Enforced by row-level security server-side.
   */
  listTeam(): Promise<Member[]>;
  /**
   * Everyone in the signed-in user's lab (same top-level professor) — the pool
   * of people they can share with. A superset of {@link listTeam} (adds
   * advisors above and lab-mates across). RLS-scoped server-side.
   */
  listDirectory(): Promise<Member[]>;
  /**
   * Active-lab roster for the org chart: supervisors, peers, and supervisees.
   * A superset of {@link listTeam}; scoped to explicit lab membership.
   */
  listLab(): Promise<Member[]>;
}

// --- self-provisioner ---
/**
 * Contract for materialising the *signed-in* user's own rows (DIP).
 *
 * Distinct from `IAccountProvisioner`, which creates accounts for other people
 * and therefore needs privileged server access. This one creates nothing the
 * caller is not already authenticated as, so it needs no elevated credentials —
 * the database derives the identity from the verified JWT.
 *
 * It exists because sign-in and storage are two different databases in this
 * deployment: Supabase Auth issues the token, a self-hosted Postgres holds
 * every row that references the user. A brand-new account exists in the first
 * and not the second until something bridges them, and the first write it
 * attempts fails on a foreign key.
 */
export interface ISelfProvisioner {
  /**
   * Ensure the calling user's identity rows exist. Idempotent and cheap after
   * the first call, so startup may invoke it unconditionally.
   */
  ensureProvisioned(force?: boolean): Promise<void>;
}

// --- supervision-repository ---
/**
 * Read contract for the supervisor view (DIP).
 *
 * A supervisor can follow the *plan* and *logbook* of the people beneath them —
 * and nothing else. This interface intentionally exposes only milestones and
 * log entries, by member, across all of that member's projects. Row-level
 * security is the ultimate gate on which members are visible.
 */
export interface ISupervisionRepository {
  /** All milestones owned by `memberId` (soonest target first). */
  listMilestones(memberId: string): Promise<Milestone[]>;
  /** All log entries owned by `memberId` (most recent first). */
  listLogs(memberId: string): Promise<LogEntry[]>;
  /**
   * The same reads for several supervisees at once, one entry per id asked
   * for (empty when they have none).
   *
   * A supervisor's dashboard otherwise made two round trips per supervisee,
   * and the filter is one `in (…)` either way.
   */
  listMilestonesFor(memberIds: readonly string[]): Promise<Map<string, Milestone[]>>;
  listLogsFor(memberIds: readonly string[]): Promise<Map<string, LogEntry[]>>;
}

// --- member ---
/** Types for member. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/** Academic roles, ordered by rank in {@link ROLE_RANK}. */
export type Role = "professor" | "phd" | "masters" | "standalone";

/** The org roles, without `standalone`: the same list an invite code names. */
export const ROLES: readonly Role[] = ORG_INVITE_ROLES;

/** Higher number = more authority. Used for creation + visibility rules. */
export const ROLE_RANK: Record<Role, number> = {
  standalone: -1,
  masters: 0,
  phd: 1,
  professor: 2,
};

/** Human-readable labels for UI. */
export const ROLE_LABELS: Record<Role, string> = {
  professor: "Professor",
  phd: "PhD supervisor",
  masters: "Master's student",
  standalone: "Standalone",
};

/**
 * A person in the organization. `id` mirrors the Supabase auth user id (so a
 * member is identifiable the same way everywhere). `supervisorId` is the member
 * one level up in the tree, or undefined for professors (tree roots).
 */
export interface Member extends Identifiable {
  id: string;
  email?: string;
  fullName?: string;
  role: Role;
  supervisorId?: string;
  /** False until user creates/joins a lab or chooses standalone mode. */
  orgSetupComplete?: boolean;
  activeOrgId?: string;
}

export interface NewMemberInput {
  email: string;
  password: string;
  fullName?: string;
  role: Role;
  /** Ignored — the creator is always recorded as supervisor server-side. */
  supervisorId?: string;
}

export class MemberValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "MemberValidationError";
  }
}

export class MemberPermissionError extends PermissionError {
  constructor(message: string) {
    super(message);
    this.name = "MemberPermissionError";
  }
}

export interface TeamVisibilityOptions {
  /** Whether the viewer belongs to at least one lab (org_memberships). */
  inLab: boolean;
  /** When set, restrict to members of the active lab. Required when inLab. */
  orgMemberIds?: ReadonlySet<string> | null;
}

// --- organization ---
/** Types for organization. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export type OrgJoinSource = "legacy" | "invite" | "create";

export interface OrgMembershipView {
  orgId: string;
  orgName: string;
  role: OrgInviteRole;
  joinSource: OrgJoinSource;
}

/** Codes returned in plaintext only at create/regenerate time. */
export interface OrgInviteCodePlaintext {
  targetRole: OrgInviteRole;
  code: string;
}

/**
 * A lab rule the caller broke: a missing name, a name that is too long.
 *
 * Distinct from the two below on purpose: a missing lab is
 * {@link OrgNotFoundError} (404) and a non-owner is {@link OrgPermissionError}
 * (403), so each org route answers the same condition with the same status.
 */
export class OrgValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "OrgValidationError";
  }
}

/** The lab named does not exist. Maps to 404 wherever it is thrown. */
export class OrgNotFoundError extends NotFoundError {
  constructor(message: string) {
    super(message);
    this.name = "OrgNotFoundError";
  }
}

/** The caller is a member of the lab but may not do this. Maps to 403. */
export class OrgPermissionError extends PermissionError {
  constructor(message: string) {
    super(message);
    this.name = "OrgPermissionError";
  }
}
