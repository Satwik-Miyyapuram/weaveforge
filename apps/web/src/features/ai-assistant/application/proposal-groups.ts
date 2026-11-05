import type { AiWriteProposal } from "@weaveforge/core";

/** How the review queue groups pending proposals. */
export type ProposalGrouping = "document" | "kind";

export interface ProposalGroup {
  /** The resource id or the proposal kind, depending on the grouping. */
  key: string;
  items: AiWriteProposal[];
}

/** Groups in the order their first proposal appears; items keep queue order. */
export function groupProposals(items: readonly AiWriteProposal[], by: ProposalGrouping): ProposalGroup[] {
  const groups = new Map<string, AiWriteProposal[]>();
  for (const item of items) {
    const key = by === "document" ? item.resourceId : item.kind;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups].map(([key, members]) => ({ key, items: members }));
}

export interface BulkResult {
  done: string[];
  /** Not applied: the target changed since the proposal was made. */
  conflicted: string[];
  /** The apply that threw, which stopped the batch. */
  failed: { id: string; error: unknown } | null;
  /** Never tried because of `failed`; still pending. */
  untouched: string[];
}

/**
 * Apply each id once, in order. A conflict is an expected answer and the batch
 * carries on; a thrown error is not, so the batch stops and the rest stay
 * pending for the reviewer to look at.
 */
export async function runBulk(
  ids: readonly string[],
  apply: (id: string) => Promise<"accepted" | "conflicted" | void>,
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  const result: BulkResult = { done: [], conflicted: [], failed: null, untouched: [] };
  for (const [index, id] of unique.entries()) {
    try {
      if ((await apply(id)) === "conflicted") result.conflicted.push(id);
      else result.done.push(id);
    } catch (error) {
      result.failed = { id, error };
      result.untouched = unique.slice(index + 1);
      break;
    }
  }
  return result;
}
