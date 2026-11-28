import type { Comment, ICommentRepository, IMemberRepository, Member } from "@weaveforge/core";

const NEEDS_ACCOUNT = "Sign in to an account for this: a copy without one has no lab server.";

/**
 * Members for a copy with no account: no session, so the org server would refuse every
 * read (401). There is no profile, team or lab to show, and nobody to create.
 */
export class NoAccountMemberRepository implements IMemberRepository {
  async getMine(): Promise<Member | null> {
    return null;
  }

  async listTeam(): Promise<Member[]> {
    return [];
  }

  async listDirectory(): Promise<Member[]> {
    return [];
  }

  async listLab(): Promise<Member[]> {
    return [];
  }

  async assertCanCreate(_role: string): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }
}

/** Comment threads live on the org server; a copy with no account has none. */
export class NoAccountCommentRepository implements ICommentRepository {
  async list(): Promise<Comment[]> {
    return [];
  }

  async add(): Promise<Comment> {
    throw new Error(NEEDS_ACCOUNT);
  }

  async remove(): Promise<void> {
    throw new Error(NEEDS_ACCOUNT);
  }

  async setResolved(): Promise<string | null> {
    throw new Error(NEEDS_ACCOUNT);
  }
}
