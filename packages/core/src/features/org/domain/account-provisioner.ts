/**
 * Contract for provisioning new accounts (DIP).
 *
 * Creating an auth account requires privileged (service-role) access, which the
 * browser must never hold. The concrete implementation therefore delegates to a
 * trusted server endpoint; the domain/use-case layer depends only on this
 * interface. Swapping the transport (HTTP route, RPC, admin SDK) touches only
 * the adapter.
 */

import type { Member, NewMemberInput } from "./member.js";

export interface IAccountProvisioner {
  /**
   * Create an auth account + member record. The server independently
   * re-validates that the caller is allowed to create the requested role.
   */
  createMember(input: NewMemberInput): Promise<Member>;
}
