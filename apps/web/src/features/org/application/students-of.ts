import { accessibleMemberIds, type Member } from "@weaveforge/core";

/**
 * The people below `viewerId` in the supervisor tree, at any depth. The
 * visible team can also hold the viewer's own supervisor, who is not a student.
 */
export function studentsOf(viewerId: string | undefined, team: readonly Member[]): Member[] {
  if (!viewerId) return [];
  const below = accessibleMemberIds(viewerId, team);
  return team.filter((m) => m.id !== viewerId && below.has(m.id));
}
