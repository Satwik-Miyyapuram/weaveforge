import type { Member, NewMemberInput } from "../features/org/domain/member.js";
import type { IAccountProvisioner } from "../features/org/domain/account-provisioner.js";
import type { InMemoryMemberRepository } from "./in-memory-member-repository.js";

/**
 * In-memory {@link IAccountProvisioner} for tests. Mints an id, records the new
 * member in the paired repository, and returns it — no network, no auth. The
 * caller decides the supervisor (the use-case resolves it before calling here).
 */
export class InMemoryAccountProvisioner implements IAccountProvisioner {
  private seq = 0;
  constructor(
    private readonly members: InMemoryMemberRepository,
    private readonly supervisorFor: () => string | undefined = () => undefined,
  ) {}

  async createMember(input: NewMemberInput): Promise<Member> {
    const member: Member = {
      id: `user-${++this.seq}`,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      supervisorId: input.supervisorId ?? this.supervisorFor(),
    };
    this.members.upsert(member);
    return member;
  }
}
