import type { Member } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

export function buildMemberNameMap(members: Member[]): Map<string, string> {
  return readyCore().memberNameMap(members);
}
