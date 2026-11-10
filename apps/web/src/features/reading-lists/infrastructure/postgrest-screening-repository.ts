import type { SupabaseClient } from "@supabase/supabase-js";
import type { IScreeningRepository, ScreeningDecision } from "@weaveforge/core";
import type { ScreeningDecisionRow } from "@weaveforge/wasm";

import { rows, run } from "@/backend/providers/postgrest/row-access";
import { readyCore } from "@/lib/rust-core";

/**
 * Screening decisions, in the table both providers share.
 *
 * Persistence only. Note what is *not* here: no filtering by reviewer, and no
 * "my decision" convenience. Every reviewer's row comes back, because a screen
 * where you cannot see that somebody disagreed with you is not a screen -- and
 * the policies already decide which rows a caller may see.
 */

/**
 * The columns a ScreeningDecisionRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const SCREENING_DECISION_COLUMNS = "id,item_id,reviewer_id,stage,state,reason,decided_at";

const TABLE = "screening_decisions";

// Row mapping runs in the Rust core (wf-core `reading_lists::screening::decision_from_row`).
const toDomain = (row: ScreeningDecisionRow): ScreeningDecision =>
  readyCore().screeningDecisionFromRow(row) as ScreeningDecision;
const toRow = (decision: ScreeningDecision): ScreeningDecisionRow =>
  readyCore().screeningDecisionToRow(decision);

export class PostgrestScreeningRepository implements IScreeningRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listForItems(itemIds: readonly string[]): Promise<ScreeningDecision[]> {
    if (!itemIds.length) return [];
    const found = await rows<ScreeningDecisionRow>(
      this.db.from(TABLE).select(SCREENING_DECISION_COLUMNS).in("item_id", [...itemIds]).order("decided_at"),
    );
    return found.map(toDomain);
  }

  async record(decision: ScreeningDecision): Promise<void> {
    // Conflict on the natural key rather than the id: the same reviewer
    // answering the same item again is a change of mind, and the row it should
    // replace is the one they already wrote, whatever id the caller minted.
    await run(this.db.from(TABLE).upsert(toRow(decision), { onConflict: "item_id,reviewer_id,stage" }));
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }
}
