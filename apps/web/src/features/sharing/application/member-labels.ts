import type { Member } from "@weaveforge/core";

export function memberDisplayName(member: Member): string {
  return member.fullName ?? member.email ?? "Member";
}

export function buildMemberNameMap(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m.id, memberDisplayName(m)]));
}
