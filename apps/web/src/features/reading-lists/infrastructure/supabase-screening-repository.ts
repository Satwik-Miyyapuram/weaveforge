import type { SupabaseClient } from "@supabase/supabase-js";
import type { IScreeningRepository, ScreeningDecision } from "@weaveforge/core";

import { rows, run } from "@/backend/providers/supabase/row-access";

/**
 * Screening decisions, in the table both providers share.
 *
 * Persistence only. Note what is *not* here: no filtering by reviewer, and no
 * "my decision" convenience. Every reviewer's row comes back, because a screen
 * where you cannot see that somebody disagreed with you is not a screen -- and
 * the policies already decide which rows a caller may see.
 */

const TABLE = "screening_decisions";

interface ScreeningDecisionRow {
  id: string;
  item_id: string;
  reviewer_id: string;
  stage: string;
  state: string;
  reason: string | null;
  decided_at: string;
}

function toDomain(row: ScreeningDecisionRow): ScreeningDecision {
  return {
    id: row.id,
    itemId: row.item_id,
    reviewerId: row.reviewer_id,
    stage: row.stage as ScreeningDecision["stage"],
    state: row.state as ScreeningDecision["state"],
    reason: row.reason ?? undefined,
    decidedAt: row.decided_at,
  };
}

export class SupabaseScreeningRepository implements IScreeningRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listForItems(itemIds: readonly string[]): Promise<ScreeningDecision[]> {
    if (!itemIds.length) return [];
    const found = await rows<ScreeningDecisionRow>(
      this.db.from(TABLE).select("*").in("item_id", [...itemIds]).order("decided_at"),
    );
    return found.map(toDomain);
  }

  async record(decision: ScreeningDecision): Promise<void> {
    // Conflict on the natural key rather than the id: the same reviewer
    // answering the same item again is a change of mind, and the row it should
    // replace is the one they already wrote, whatever id the caller minted.
    await run(
      this.db.from(TABLE).upsert(
        {
          id: decision.id,
          item_id: decision.itemId,
          reviewer_id: decision.reviewerId,
          stage: decision.stage,
          state: decision.state,
          reason: decision.reason ?? null,
          decided_at: decision.decidedAt,
        },
        { onConflict: "item_id,reviewer_id,stage" },
      ),
    );
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }
}
