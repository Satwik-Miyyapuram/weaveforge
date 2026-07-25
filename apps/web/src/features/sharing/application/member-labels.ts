import type { Member } from "@thesis/core";

export function memberDisplayName(member: Member): string {
  return member.fullName ?? member.email ?? "Member";
}

export function buildMemberNameMap(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m.id, memberDisplayName(m)]));
}

export function resolveMemberName(
  members: Member[] | Map<string, string>,
  memberId: string,
): string {
  if (members instanceof Map) return members.get(memberId) ?? "Member";
  const member = members.find((m) => m.id === memberId);
  return member ? memberDisplayName(member) : "Member";
}
