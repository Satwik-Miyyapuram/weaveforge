/**
 * Use-case for creating organization members. Orchestration + permission rules
 * only (DIP): it enforces the creation hierarchy client-side for good UX, then
 * delegates the actual account creation to the injected provisioner. The server
 * re-enforces the same rules authoritatively — this is never the only gate.
 */
import {
  canCreateRole,
  validateNewMember,
  MemberPermissionError,
  type Member,
  type NewMemberInput,
} from "../domain/member.js";
import type { IMemberRepository } from "../domain/member-repository.js";
import type { IAccountProvisioner } from "../domain/account-provisioner.js";

export interface CreateMemberDeps {
  members: IMemberRepository;
  provisioner: IAccountProvisioner;
}

export class CreateMemberUseCase {
  constructor(private readonly deps: CreateMemberDeps) {}

  /**
   * Create an account beneath the signed-in user. Throws
   * {@link MemberPermissionError} if the caller lacks a member record or may not
   * create the requested role.
   */
  async create(input: NewMemberInput): Promise<Member> {
    const normalized = validateNewMember(input);
    const me = await this.deps.members.getMine();
    if (!me) {
      throw new MemberPermissionError("Only registered members can create accounts.");
    }
    if (!canCreateRole(me.role, normalized.role)) {
      throw new MemberPermissionError(
        `A ${me.role} cannot create a ${normalized.role} account.`,
      );
    }
    return this.deps.provisioner.createMember(normalized);
  }
}
