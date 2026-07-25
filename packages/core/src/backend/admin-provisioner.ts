import type { Member, Role } from "../features/org/domain/member.js";

export interface ProvisionUserInput {
  email: string;
  password: string;
  fullName?: string;
  role: Role;
  supervisorId?: string;
}

/**
 * Privileged account creation (service-role / admin API).
 * Used by POST /api/admin/create-user — never exposed to the browser SDK.
 */
export interface IAdminUserProvisioner {
  /** Resolve the caller from a bearer access token. */
  resolveCaller(accessToken: string): Promise<Member | null>;
  /** Create auth account + member profile. Rolls back on profile failure. */
  provisionUser(input: ProvisionUserInput): Promise<Member>;
  /** Delete caller's account and all app data (requires service role). */
  deleteOwnAccount(accessToken: string): Promise<void>;
}
