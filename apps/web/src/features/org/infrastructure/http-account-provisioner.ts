import type { IAccountProvisioner, Member, NewMemberInput } from "@weaveforge/core";
import type { IAuthService } from "@/features/auth/domain/auth";

/**
 * Provisions accounts by POSTing to our own privileged server route
 * (/api/admin/create-user), which holds the Supabase service-role key. The
 * caller's access token authenticates the request so the server can re-check
 * permissions. This is the only adapter that talks to that route.
 */
export class HttpAccountProvisioner implements IAccountProvisioner {
  constructor(
    private readonly auth: Pick<IAuthService, "getAccessToken">,
    private readonly endpoint = "/api/admin/create-user",
  ) {}

  async createMember(input: NewMemberInput): Promise<Member> {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("You must be signed in to create accounts.");
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      member?: Member;
      error?: string;
    };
    if (!res.ok || !payload.member) {
      throw new Error(payload.error ?? `Failed to create account (${res.status}).`);
    }
    return payload.member;
  }
}
