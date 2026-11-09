import type { Member } from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";

/**
 * The people below `viewerId` in the supervisor tree, at any depth. The
 * visible team can also hold the viewer's own supervisor, who is not a student.
 * The rule is Rust (wf-core `member`, `students_of`).
 */
export function studentsOf(viewerId: string | undefined, team: readonly Member[]): Member[] {
  return readyCore().studentsOf(viewerId, team);
}
