/**
 * Crockford Base32 invite codes — normalization and join assignment (browser-safe).
 */

export const ORG_INVITE_ROLES = ["professor", "phd", "masters"] as const;
export type OrgInviteRole = (typeof ORG_INVITE_ROLES)[number];

export function formatInviteCode(raw: string): string {
  const s = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return s.match(/.{1,3}/g)?.join("-") ?? s;
}

/** Strip separators; map common typos (i/l→1, o→0). */
export function normalizeOrgInviteCode(input: string): string {
  return input
    .replace(/[-\s]/g, "")
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

export class OrgInviteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgInviteValidationError";
  }
}

export interface JoinOrgInput {
  code: string;
  /** Required for masters join — PhD supervisor within the org. */
  phdSupervisorId?: string;
  /** Required for phd join when the org has multiple professors. */
  professorSupervisorId?: string;
}

export interface JoinOrgContext {
  targetRole: OrgInviteRole;
  orgOwnerId: string;
  professorIds: readonly string[];
  phdIds: readonly string[];
}

/** Resolve profile role + supervisor after a successful code lookup. */
export function resolveOrgJoinAssignment(
  ctx: JoinOrgContext,
  input: JoinOrgInput,
): { role: OrgInviteRole; supervisorId: string | undefined } {
  switch (ctx.targetRole) {
    case "professor":
      return { role: "professor", supervisorId: undefined };
    case "phd": {
      const prof =
        ctx.professorIds.length === 1
          ? ctx.professorIds[0]
          : input.professorSupervisorId;
      if (!prof || !ctx.professorIds.includes(prof)) {
        throw new OrgInviteValidationError("Choose a professor supervisor for this lab.");
      }
      return { role: "phd", supervisorId: prof };
    }
    case "masters": {
      const phd = input.phdSupervisorId;
      if (!phd || !ctx.phdIds.includes(phd)) {
        throw new OrgInviteValidationError("Choose a PhD supervisor in this lab.");
      }
      return { role: "masters", supervisorId: phd };
    }
    default:
      throw new OrgInviteValidationError("Unknown invite type.");
  }
}
